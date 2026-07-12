import { Database } from 'sqlite3';

import { allDb, getDb, getDbInstance, runDb } from '../database/connection';
import {
  AccessControlRepository,
  ConnectionGroupGrant,
  CreateGroupRecord,
  GroupMembership,
  UserGroup,
} from './access-control.application';
import { ConnectionGrant } from './access-policy';

type DatabaseProvider = () => Promise<Database>;

export class SqliteAccessControlRepository implements AccessControlRepository {
  constructor(private readonly getDatabase: DatabaseProvider = getDbInstance) {}

  async createGroup(input: CreateGroupRecord): Promise<UserGroup> {
    const db = await this.getDatabase();
    await runDb(db, 'BEGIN IMMEDIATE TRANSACTION');
    try {
      const result = await runDb(db, `
        INSERT INTO user_groups(name, description, created_by)
        VALUES (?, ?, ?)
      `, [input.name, input.description ?? null, input.createdBy]);
      await runDb(db, `
        INSERT INTO user_group_members(group_id, user_id, role)
        VALUES (?, ?, 'owner')
      `, [result.lastID, input.createdBy]);
      await runDb(db, 'COMMIT');
      return { id: result.lastID, ...input };
    } catch (error) {
      await runDb(db, 'ROLLBACK');
      throw error;
    }
  }

  async readGroup(groupId: number): Promise<UserGroup | null> {
    const db = await this.getDatabase();
    const row = await getDb<{ id: number; name: string; description: string | null; created_by: number }>(db, `
      SELECT id, name, description, created_by FROM user_groups WHERE id = ?
    `, [groupId]);
    return row ? { id: row.id, name: row.name, description: row.description ?? undefined, createdBy: row.created_by } : null;
  }

  async updateGroup(groupId: number, input: { name: string; description?: string }): Promise<UserGroup | null> {
    const db = await this.getDatabase();
    const result = await runDb(db, `UPDATE user_groups
      SET name = ?, description = ?, updated_at = strftime('%s', 'now') WHERE id = ?`,
    [input.name, input.description ?? null, groupId]);
    return result.changes > 0 ? this.readGroup(groupId) : null;
  }

  async deleteGroup(groupId: number): Promise<boolean> {
    const db = await this.getDatabase();
    return (await runDb(db, 'DELETE FROM user_groups WHERE id = ?', [groupId])).changes > 0;
  }

  async readMembership(groupId: number, userId: number): Promise<GroupMembership | null> {
    const db = await this.getDatabase();
    const row = await getDb<{ group_id: number; user_id: number; role: GroupMembership['role'] }>(db, `
      SELECT group_id, user_id, role
      FROM user_group_members
      WHERE group_id = ? AND user_id = ?
    `, [groupId, userId]);
    return row ? { groupId: row.group_id, userId: row.user_id, role: row.role } : null;
  }

  async saveMembership(input: GroupMembership): Promise<GroupMembership> {
    const db = await this.getDatabase();
    await runDb(db, 'BEGIN IMMEDIATE TRANSACTION');
    try {
      const current = await getDb<{ role: GroupMembership['role'] }>(db, `
        SELECT role FROM user_group_members WHERE group_id = ? AND user_id = ?
      `, [input.groupId, input.userId]);
      if (current?.role === 'owner' && input.role !== 'owner') {
        const owners = await getDb<{ count: number }>(db, `
          SELECT COUNT(*) AS count FROM user_group_members WHERE group_id = ? AND role = 'owner'
        `, [input.groupId]);
        if ((owners?.count ?? 0) <= 1) throw new Error('A group must retain at least one owner.');
      }
      await runDb(db, `INSERT INTO user_group_members(group_id, user_id, role)
        VALUES (?, ?, ?)
        ON CONFLICT(group_id, user_id) DO UPDATE SET
          role = excluded.role, updated_at = strftime('%s', 'now')`,
      [input.groupId, input.userId, input.role]);
      await runDb(db, 'COMMIT');
      return input;
    } catch (error) {
      await runDb(db, 'ROLLBACK');
      throw error;
    }
  }

  async deleteMembership(groupId: number, userId: number): Promise<boolean> {
    const db = await this.getDatabase();
    await runDb(db, 'BEGIN IMMEDIATE TRANSACTION');
    try {
      const current = await getDb<{ role: GroupMembership['role'] }>(db, `
        SELECT role FROM user_group_members WHERE group_id = ? AND user_id = ?
      `, [groupId, userId]);
      if (!current) {
        await runDb(db, 'ROLLBACK');
        return false;
      }
      if (current.role === 'owner') {
        const owners = await getDb<{ count: number }>(db, `
          SELECT COUNT(*) AS count FROM user_group_members WHERE group_id = ? AND role = 'owner'
        `, [groupId]);
        if ((owners?.count ?? 0) <= 1) throw new Error('A group must retain at least one owner.');
      }
      await runDb(db, 'DELETE FROM user_group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
      await runDb(db, 'COMMIT');
      return true;
    } catch (error) {
      await runDb(db, 'ROLLBACK');
      throw error;
    }
  }

  async readConnectionAccess(userId: number, connectionId: number): Promise<{
    ownerUserId: number | null;
    grants: ConnectionGrant[];
  } | null> {
    const db = await this.getDatabase();
    const connection = await getDb<{ owner_user_id: number | null }>(db, `
      SELECT owner_user_id FROM connections WHERE id = ?
    `, [connectionId]);
    if (!connection) return null;

    const grants = await allDb<{ group_role: ConnectionGrant['groupRole']; permission: ConnectionGrant['permission'] }>(db, `
      SELECT membership.role AS group_role, permission.permission
      FROM connection_group_permissions permission
      JOIN user_group_members membership ON membership.group_id = permission.group_id
      WHERE permission.connection_id = ? AND membership.user_id = ?
    `, [connectionId, userId]);

    return {
      ownerUserId: connection.owner_user_id,
      grants: grants.map((grant) => ({
        groupRole: grant.group_role,
        permission: grant.permission,
      })),
    };
  }

  async saveConnectionGrant(input: ConnectionGroupGrant): Promise<ConnectionGroupGrant> {
    const db = await this.getDatabase();
    await runDb(db, `
      INSERT INTO connection_group_permissions(connection_id, group_id, permission)
      VALUES (?, ?, ?)
      ON CONFLICT(connection_id, group_id) DO UPDATE SET
        permission = excluded.permission,
        updated_at = strftime('%s', 'now')
    `, [input.connectionId, input.groupId, input.permission]);
    return input;
  }

  async deleteConnectionGrant(connectionId: number, groupId: number): Promise<boolean> {
    const db = await this.getDatabase();
    return (await runDb(db, `DELETE FROM connection_group_permissions
      WHERE connection_id = ? AND group_id = ?`, [connectionId, groupId])).changes > 0;
  }

  async listGroupsForUser(userId: number, includeAll: boolean): Promise<Array<UserGroup & {
    memberRole: GroupMembership['role'] | null;
  }>> {
    const db = await this.getDatabase();
    const rows = await allDb<{
      id: number;
      name: string;
      description: string | null;
      created_by: number;
      member_role: GroupMembership['role'] | null;
    }>(db, `
      SELECT groups.id, groups.name, groups.description, groups.created_by,
             membership.role AS member_role
      FROM user_groups groups
      LEFT JOIN user_group_members membership
        ON membership.group_id = groups.id AND membership.user_id = ?
      WHERE ? = 1 OR membership.user_id IS NOT NULL
      ORDER BY groups.name, groups.id
    `, [userId, includeAll ? 1 : 0]);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      createdBy: row.created_by,
      memberRole: row.member_role,
    }));
  }

  async listMembers(groupId: number): Promise<Array<GroupMembership & { username: string }>> {
    const db = await this.getDatabase();
    const rows = await allDb<{
      group_id: number;
      user_id: number;
      username: string;
      role: GroupMembership['role'];
    }>(db, `
      SELECT membership.group_id, membership.user_id, users.username, membership.role
      FROM user_group_members membership
      JOIN users ON users.id = membership.user_id
      WHERE membership.group_id = ?
      ORDER BY users.username, users.id
    `, [groupId]);
    return rows.map((row) => ({
      groupId: row.group_id,
      userId: row.user_id,
      username: row.username,
      role: row.role,
    }));
  }

  async listConnectionGrants(connectionId: number): Promise<Array<ConnectionGroupGrant & {
    groupName: string;
  }>> {
    const db = await this.getDatabase();
    const rows = await allDb<{
      connection_id: number;
      group_id: number;
      group_name: string;
      permission: ConnectionGroupGrant['permission'];
    }>(db, `
      SELECT permission.connection_id, permission.group_id,
             groups.name AS group_name, permission.permission
      FROM connection_group_permissions permission
      JOIN user_groups groups ON groups.id = permission.group_id
      WHERE permission.connection_id = ?
      ORDER BY groups.name, groups.id
    `, [connectionId]);
    return rows.map((row) => ({
      connectionId: row.connection_id,
      groupId: row.group_id,
      groupName: row.group_name,
      permission: row.permission,
    }));
  }
}

export const accessControlRepository = new SqliteAccessControlRepository();

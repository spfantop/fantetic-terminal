import { Database } from 'sqlite3';

import { allDb, getDb, getDbInstance, runDb } from '../database/connection';
import { SystemRole } from './access-policy';
import {
  ManagedUser,
  UserAdministrationRepository,
} from './user-administration.application';

type DatabaseProvider = () => Promise<Database>;
type UserRow = {
  id: number;
  username: string;
  system_role: SystemRole;
  status: 'active' | 'disabled';
};

const mapUser = (row: UserRow): ManagedUser => ({
  id: row.id,
  username: row.username,
  systemRole: row.system_role,
  status: row.status,
});

export class SqliteUserAdministrationRepository implements UserAdministrationRepository {
  constructor(private readonly getDatabase: DatabaseProvider = getDbInstance) {}

  async listUsers(): Promise<ManagedUser[]> {
    const rows = await allDb<UserRow>(await this.getDatabase(), `
      SELECT id, username, system_role, status FROM users ORDER BY username, id
    `);
    return rows.map(mapUser);
  }

  async readUser(userId: number): Promise<ManagedUser | null> {
    const row = await getDb<UserRow>(await this.getDatabase(), `
      SELECT id, username, system_role, status FROM users WHERE id = ?
    `, [userId]);
    return row ? mapUser(row) : null;
  }

  async createUser(input: {
    username: string;
    hashedPassword: string;
    systemRole: SystemRole;
  }): Promise<ManagedUser> {
    const db = await this.getDatabase();
    const result = await runDb(db, `
      INSERT INTO users(username, hashed_password, system_role, status)
      VALUES (?, ?, ?, 'active')
    `, [input.username, input.hashedPassword, input.systemRole]);
    return (await this.readUser(result.lastID))!;
  }

  async updateUser(input: {
    userId: number;
    systemRole?: SystemRole;
    status?: 'active' | 'disabled';
  }): Promise<ManagedUser> {
    const current = await this.readUser(input.userId);
    if (!current) throw new Error('User not found.');
    await runDb(await this.getDatabase(), `
      UPDATE users
      SET system_role = ?, status = ?, updated_at = strftime('%s', 'now')
      WHERE id = ?
    `, [input.systemRole ?? current.systemRole, input.status ?? current.status, input.userId]);
    return (await this.readUser(input.userId))!;
  }

  async updatePassword(userId: number, hashedPassword: string): Promise<void> {
    const result = await runDb(await this.getDatabase(), `
      UPDATE users
      SET hashed_password = ?, auth_epoch = auth_epoch + 1, updated_at = strftime('%s', 'now')
      WHERE id = ?
    `, [hashedPassword, userId]);
    if (result.changes === 0) throw new Error('User not found.');
  }

  async deleteUser(userId: number, transferToUserId: number): Promise<void> {
    const db = await this.getDatabase();
    await runDb(db, 'BEGIN IMMEDIATE TRANSACTION');
    try {
      await runDb(db, `
        INSERT INTO user_group_members(group_id, user_id, role)
        SELECT group_id, ?, 'owner' FROM user_group_members
        WHERE user_id = ? AND role = 'owner'
        ON CONFLICT(group_id, user_id) DO UPDATE SET role = 'owner', updated_at = strftime('%s', 'now')
      `, [transferToUserId, userId]);
      await runDb(db, `
        INSERT OR IGNORE INTO connection_tags(connection_id, tag_id)
        SELECT connection_tags.connection_id, receiver_tag.id
        FROM connection_tags
        JOIN tags source_tag ON source_tag.id = connection_tags.tag_id
        JOIN tags receiver_tag
          ON receiver_tag.owner_user_id = ? AND receiver_tag.name = source_tag.name
        WHERE source_tag.owner_user_id = ?
      `, [transferToUserId, userId]);
      await runDb(db, `
        DELETE FROM tags
        WHERE owner_user_id = ? AND EXISTS (
          SELECT 1 FROM tags receiver_tag
          WHERE receiver_tag.owner_user_id = ? AND receiver_tag.name = tags.name
        )
      `, [userId, transferToUserId]);
      for (const table of ['connections', 'proxies', 'ssh_keys', 'connection_folders', 'tags']) {
        await runDb(db, `UPDATE ${table} SET owner_user_id = ? WHERE owner_user_id = ?`, [transferToUserId, userId]);
      }
      const result = await runDb(db, 'DELETE FROM users WHERE id = ?', [userId]);
      if (result.changes === 0) throw new Error('User not found.');
      await runDb(db, 'COMMIT');
    } catch (error) {
      await runDb(db, 'ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  async countActiveSuperAdmins(): Promise<number> {
    const row = await getDb<{ count: number }>(await this.getDatabase(), `
      SELECT COUNT(*) AS count FROM users
      WHERE system_role = 'super_admin' AND status = 'active'
    `);
    return row?.count ?? 0;
  }
}

export const userAdministrationRepository = new SqliteUserAdministrationRepository();

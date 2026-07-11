import { AuthorizationSubject } from './authorization-subject';
import {
  ConnectionGrant,
  GroupRole,
  hasConnectionPermission,
  resolveConnectionPermission,
} from './access-policy';

export type UserGroup = {
  id: number;
  name: string;
  description?: string;
  createdBy: number;
};

export type CreateGroupRecord = Omit<UserGroup, 'id'>;

export type GroupMembership = {
  groupId: number;
  userId: number;
  role: GroupRole;
};

export type ConnectionGroupGrant = {
  connectionId: number;
  groupId: number;
  permission: 'view' | 'connect' | 'manage';
};

export interface AccessControlRepository {
  createGroup(input: CreateGroupRecord): Promise<UserGroup>;
  readMembership(groupId: number, userId: number): Promise<GroupMembership | null>;
  saveMembership(input: GroupMembership): Promise<GroupMembership>;
  readConnectionAccess(userId: number, connectionId: number): Promise<{
    ownerUserId: number | null;
    grants: ConnectionGrant[];
  } | null>;
  saveConnectionGrant(input: ConnectionGroupGrant): Promise<ConnectionGroupGrant>;
  listGroupsForUser(userId: number, includeAll: boolean): Promise<Array<UserGroup & {
    memberRole: GroupRole | null;
  }>>;
  listMembers(groupId: number): Promise<Array<GroupMembership & { username: string }>>;
  listConnectionGrants(connectionId: number): Promise<Array<ConnectionGroupGrant & {
    groupName: string;
  }>>;
}

export class AccessControlApplication {
  constructor(private readonly repository: AccessControlRepository) {}

  async createGroup(
    subject: AuthorizationSubject,
    input: { name: string; description?: string },
  ): Promise<UserGroup> {
    if (subject.systemRole !== 'super_admin' && subject.systemRole !== 'admin') {
      throw new Error('A system administrator is required to create user groups.');
    }

    const name = input.name.trim();
    if (!name) throw new Error('A group name is required.');

    return this.repository.createGroup({
      name,
      description: input.description?.trim() || undefined,
      createdBy: subject.userId,
    });
  }

  listGroups(subject: AuthorizationSubject) {
    const includeAll = subject.systemRole === 'super_admin' || subject.systemRole === 'admin';
    return this.repository.listGroupsForUser(subject.userId, includeAll);
  }

  async listMembers(subject: AuthorizationSubject, groupId: number) {
    const systemAdministrator = subject.systemRole === 'super_admin' || subject.systemRole === 'admin';
    if (!systemAdministrator && !(await this.repository.readMembership(groupId, subject.userId))) {
      throw new Error('The current user cannot view group members.');
    }
    return this.repository.listMembers(groupId);
  }

  async listConnectionGrants(subject: AuthorizationSubject, connectionId: number) {
    const access = await this.repository.readConnectionAccess(subject.userId, connectionId);
    if (!access) throw new Error('Connection not found.');
    const permission = resolveConnectionPermission({
      userId: subject.userId,
      systemRole: subject.systemRole,
      ownerUserId: access.ownerUserId,
      grants: access.grants,
    });
    if (!hasConnectionPermission(permission, 'view')) {
      throw new Error('The current user cannot view connection grants.');
    }
    return this.repository.listConnectionGrants(connectionId);
  }

  async requireConnectionPermission(
    subject: AuthorizationSubject,
    connectionId: number,
    required: 'view' | 'connect' | 'manage',
  ) {
    const access = await this.repository.readConnectionAccess(subject.userId, connectionId);
    if (!access) throw new Error('Connection not found.');
    const permission = resolveConnectionPermission({
      userId: subject.userId,
      systemRole: subject.systemRole,
      ownerUserId: access.ownerUserId,
      grants: access.grants,
    });
    if (!hasConnectionPermission(permission, required)) {
      throw new Error('The current user does not have the required connection access.');
    }
    return permission;
  }

  async saveMember(
    subject: AuthorizationSubject,
    groupId: number,
    input: { userId: number; role: GroupRole },
  ): Promise<GroupMembership> {
    const systemAdministrator = subject.systemRole === 'super_admin' || subject.systemRole === 'admin';
    const actorMembership = systemAdministrator
      ? null
      : await this.repository.readMembership(groupId, subject.userId);
    const actorGroupRole = actorMembership?.role;

    if (!systemAdministrator && actorGroupRole !== 'owner' && actorGroupRole !== 'admin') {
      throw new Error('The current user cannot manage group members.');
    }

    if ((input.role === 'owner' || input.role === 'admin')
      && !systemAdministrator
      && actorGroupRole !== 'owner') {
      throw new Error('A group owner is required to grant owner or admin membership.');
    }

    return this.repository.saveMembership({
      groupId,
      userId: input.userId,
      role: input.role,
    });
  }

  async saveConnectionGrant(
    subject: AuthorizationSubject,
    connectionId: number,
    input: { groupId: number; permission: 'view' | 'connect' | 'manage' },
  ): Promise<ConnectionGroupGrant> {
    const access = await this.repository.readConnectionAccess(subject.userId, connectionId);
    if (!access) throw new Error('Connection not found.');

    const permission = resolveConnectionPermission({
      userId: subject.userId,
      systemRole: subject.systemRole,
      ownerUserId: access.ownerUserId,
      grants: access.grants,
    });
    if (!hasConnectionPermission(permission, 'manage')) {
      throw new Error('The current user cannot manage connection grants.');
    }

    return this.repository.saveConnectionGrant({
      connectionId,
      groupId: input.groupId,
      permission: input.permission,
    });
  }
}

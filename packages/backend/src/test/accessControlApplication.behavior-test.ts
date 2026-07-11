import assert from 'node:assert/strict';

import {
  AccessControlApplication,
  AccessControlRepository,
} from '../access-control/access-control.application';
import { AuthorizationSubject } from '../access-control/authorization-subject';

const createdGroups: Array<{ name: string; createdBy: number }> = [];
const repository: AccessControlRepository = {
  async createGroup(input) {
    createdGroups.push({ name: input.name, createdBy: input.createdBy });
    return { id: 1, ...input };
  },
  async readMembership(groupId, userId) {
    if (groupId === 1 && userId === 1) return { groupId, userId, role: 'owner' };
    if (groupId === 1 && userId === 3) return { groupId, userId, role: 'admin' };
    return null;
  },
  async saveMembership(input) { return input; },
  async readConnectionAccess(_userId, connectionId) {
    return connectionId === 10
      ? { ownerUserId: 1, grants: [] }
      : { ownerUserId: 99, grants: [] };
  },
  async saveConnectionGrant(input) { return input; },
  async listGroupsForUser() { return []; },
  async listMembers() { return []; },
  async listConnectionGrants() { return []; },
};
const application = new AccessControlApplication(repository);
const admin: AuthorizationSubject = {
  runtime: 'web', userId: 1, username: 'root', systemRole: 'super_admin',
};
const user: AuthorizationSubject = {
  runtime: 'web', userId: 2, username: 'alice', systemRole: 'user',
};
const groupAdmin: AuthorizationSubject = {
  runtime: 'web', userId: 3, username: 'group-admin', systemRole: 'user',
};

assert.deepEqual(await application.createGroup(admin, {
  name: 'Production Ops',
  description: 'Production operators',
}), {
  id: 1,
  name: 'Production Ops',
  description: 'Production operators',
  createdBy: 1,
});
assert.deepEqual(createdGroups, [{ name: 'Production Ops', createdBy: 1 }]);

await assert.rejects(
  application.createGroup(user, { name: 'Shadow admins' }),
  /system administrator/i,
);

assert.deepEqual(await application.saveConnectionGrant(admin, 10, {
  groupId: 1,
  permission: 'connect',
}), { connectionId: 10, groupId: 1, permission: 'connect' });

await assert.rejects(
  application.saveConnectionGrant(user, 10, { groupId: 1, permission: 'view' }),
  /manage connection/i,
);

assert.equal(await application.requireConnectionPermission(admin, 10, 'manage'), 'manage');
await assert.rejects(
  application.requireConnectionPermission(user, 10, 'view'),
  /connection access/i,
);

assert.deepEqual(await application.saveMember(admin, 1, {
  userId: 2,
  role: 'operator',
}), { groupId: 1, userId: 2, role: 'operator' });

assert.deepEqual(await application.saveMember(groupAdmin, 1, {
  userId: 2,
  role: 'viewer',
}), { groupId: 1, userId: 2, role: 'viewer' });

await assert.rejects(
  application.saveMember(groupAdmin, 1, { userId: 2, role: 'admin' }),
  /owner/i,
);

await assert.rejects(
  application.saveMember(user, 1, { userId: 3, role: 'viewer' }),
  /manage group/i,
);

await assert.rejects(
  application.createGroup(admin, { name: '   ' }),
  /name/i,
);

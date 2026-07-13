import assert from 'node:assert/strict';

import {
  AccessControlApplication,
  AccessControlRepository,
} from '../access-control/access-control.application';
import { AuthorizationSubject } from '../access-control/authorization-subject';

const createdGroups: Array<{ name: string; createdBy: number }> = [];
const savedGrantBatches: Array<Array<{ connectionId: number; groupId: number; permission: 'view' | 'connect' | 'manage' }>> = [];
const repository: AccessControlRepository = {
  async createGroup(input) {
    createdGroups.push({ name: input.name, createdBy: input.createdBy });
    return { id: 1, ...input };
  },
  async readGroup(groupId) { return groupId === 1 ? { id: 1, name: 'ops', createdBy: 1 } : null; },
  async updateGroup(groupId, input) { return groupId === 1 ? { id: 1, ...input, createdBy: 1 } : null; },
  async deleteGroup(groupId) { return groupId === 1; },
  async readMembership(groupId, userId) {
    if (groupId === 1 && userId === 1) return { groupId, userId, role: 'owner' };
    if (groupId === 1 && userId === 3) return { groupId, userId, role: 'admin' };
    return null;
  },
  async saveMembership(input) { return input; },
  async deleteMembership(groupId, userId) { return groupId === 1 && userId === 1; },
  async readConnectionAccess(_userId, connectionId) {
    return connectionId === 10
      ? { ownerUserId: 1, grants: [] }
      : { ownerUserId: 99, grants: [] };
  },
  async saveConnectionGrant(input) { return input; },
  async saveConnectionGrants(input) { savedGrantBatches.push(input); return input; },
  async deleteConnectionGrant(connectionId, groupId) { return connectionId === 10 && groupId === 1; },
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

assert.equal((await application.saveConnectionGrants(admin, {
  connectionIds: [10, 11], groupIds: [1, 2], permission: 'connect',
})).length, 4);
assert.deepEqual(savedGrantBatches[0], [
  { connectionId: 10, groupId: 1, permission: 'connect' },
  { connectionId: 10, groupId: 2, permission: 'connect' },
  { connectionId: 11, groupId: 1, permission: 'connect' },
  { connectionId: 11, groupId: 2, permission: 'connect' },
]);
await assert.rejects(application.saveConnectionGrants(admin, {
  connectionIds: Array.from({ length: 101 }, (_, index) => index + 1),
  groupIds: Array.from({ length: 51 }, (_, index) => index + 1), permission: 'view',
}), /5,000/);

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
  application.saveMember(groupAdmin, 1, { userId: 1, role: 'viewer' }),
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

assert.equal((await application.updateGroup(admin, 1, { name: 'Core Ops' })).name, 'Core Ops');
await assert.rejects(application.updateGroup(user, 1, { name: 'Hijacked' }), /owner/i);
await application.deleteConnectionGrant(admin, 10, 1);
await assert.rejects(application.deleteConnectionGrant(user, 10, 1), /connection access/i);
await application.deleteMember(admin, 1, 1);
await assert.rejects(application.deleteMember(groupAdmin, 1, 1), /owner/i);

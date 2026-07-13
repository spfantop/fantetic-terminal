import assert from 'node:assert/strict';

import { resolveConnectionPermission } from '../access-control/access-policy';

assert.equal(resolveConnectionPermission({
  userId: 2,
  systemRole: 'user',
  ownerUserId: 1,
  grants: [],
}), 'none');

assert.equal(resolveConnectionPermission({
  userId: 1,
  systemRole: 'user',
  ownerUserId: 1,
  grants: [],
}), 'manage');

assert.equal(resolveConnectionPermission({
  userId: 2,
  systemRole: 'user',
  ownerUserId: 1,
  grants: [{ groupRole: 'viewer', permission: 'manage' }],
}), 'view');

assert.equal(resolveConnectionPermission({
  userId: 2,
  systemRole: 'user',
  ownerUserId: 1,
  grants: [
    { groupRole: 'viewer', permission: 'view' },
    { groupRole: 'operator', permission: 'manage' },
  ],
}), 'connect');

assert.equal(resolveConnectionPermission({
  userId: 2,
  systemRole: 'auditor',
  ownerUserId: 1,
  grants: [],
}), 'view');

assert.equal(resolveConnectionPermission({
  userId: 2,
  systemRole: 'admin',
  ownerUserId: 1,
  grants: [],
}), 'manage');

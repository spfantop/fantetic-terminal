import assert from 'node:assert/strict';
import {
  canConnectConnection,
  canManageConnection,
  normalizeConnectionPermission,
} from '../src/features/connections/connection-permissions';

assert.equal(normalizeConnectionPermission(undefined), 'view');
assert.equal(canConnectConnection({ effective_permission: 'view' }), false);
assert.equal(canConnectConnection({ effective_permission: 'connect' }), true);
assert.equal(canConnectConnection({ effective_permission: 'manage' }), true);
assert.equal(canManageConnection({ effective_permission: 'connect' }), false);
assert.equal(canManageConnection({ effective_permission: 'manage' }), true);

console.log('connection permission behavior ok');

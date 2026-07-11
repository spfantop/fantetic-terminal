import assert from 'node:assert/strict';

import { createAuthorizationSubject } from '../access-control/authorization-subject';

assert.deepEqual(createAuthorizationSubject({
  runtime: 'web',
  userId: 12,
  username: 'alice',
  systemRole: 'user',
  status: 'active',
}), {
  runtime: 'web',
  userId: 12,
  username: 'alice',
  systemRole: 'user',
});

assert.equal(createAuthorizationSubject({
  runtime: 'web',
  userId: 12,
  username: 'alice',
  systemRole: 'user',
  status: 'disabled',
}), null);

assert.deepEqual(createAuthorizationSubject({ runtime: 'desktop' }), {
  runtime: 'desktop',
  userId: 1,
  username: 'local-app',
  systemRole: 'super_admin',
});

import assert from 'node:assert/strict';

import { readAuditContext, runWithAuditContext, setAuditActor } from '../audit/audit-context';
import { resolveAuditResult } from '../audit/audit.service';

await runWithAuditContext({ requestId: 'req-1', sourceIp: '10.0.0.1' }, async () => {
  setAuditActor({ userId: 7, username: 'operator', systemRole: 'admin' });
  await Promise.resolve();
  assert.deepEqual(readAuditContext(), {
    requestId: 'req-1', sourceIp: '10.0.0.1', actorUserId: 7, actorUsername: 'operator', actorRole: 'admin',
  });
});
assert.equal(readAuditContext(), undefined);
assert.equal(resolveAuditResult('LOGIN_FAILURE'), 'failure');
assert.equal(resolveAuditResult('PASSKEY_DELETE_UNAUTHORIZED'), 'denied');
assert.equal(resolveAuditResult('LOGIN_SUCCESS'), 'success');

console.log('audit context behavior ok');

import assert from 'node:assert/strict';

import { runAuditProtectedOperation } from '../audit/audit-high-risk';

let operationWasCalled = false;
const auditUnavailable = new Error('audit storage unavailable');
await assert.rejects(
  runAuditProtectedOperation(
    { logActionOrThrow: async () => { throw auditUnavailable; } },
    'USER_DELETED',
    { targetUserId: 7, phase: 'requested' },
    async () => { operationWasCalled = true; },
  ),
  error => error === auditUnavailable,
);
assert.equal(operationWasCalled, false, 'a high-risk mutation must not begin when its audit intent cannot be persisted');

const sequence: string[] = [];
const result = await runAuditProtectedOperation(
  { logActionOrThrow: async () => { sequence.push('audit'); return { written: true, cleanup: 'skipped' as const }; } },
  'USER_DELETED',
  { targetUserId: 7, phase: 'requested' },
  async () => { sequence.push('mutation'); return 'deleted'; },
);
assert.equal(result, 'deleted');
assert.deepEqual(sequence, ['audit', 'mutation']);

console.log('audit fail-closed behavior ok');

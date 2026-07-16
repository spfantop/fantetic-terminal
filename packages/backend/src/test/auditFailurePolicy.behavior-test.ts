import assert from 'node:assert/strict';

import { AuditLogService } from '../audit/audit.service';
import { AuditLogRepository } from '../audit/audit.repository';

const writeError = new Error('audit storage unavailable');
const reportedErrorList: unknown[] = [];
const service = new AuditLogService({
  addLog: async () => { throw writeError; },
}, error => { reportedErrorList.push(error); });

const result = await service.logAction('LOGIN_FAILURE', { reason: 'bad credentials' });
assert.equal(result.written, false);
assert.equal(result.error, writeError);
assert.deepEqual(reportedErrorList, [writeError]);

process.env.AUDIT_MAX_ENTRIES = '1000';
let executeCount = 0;
const retentionWarningList: Array<[number, number]> = [];
const repository = new AuditLogRepository({
  getDatabase: async () => ({}) as never,
  execute: async () => {
    executeCount += 1;
    return { lastID: 1, changes: 1 };
  },
  readLatestHash: async () => undefined,
  transaction: async (_db, callback) => callback({} as never),
  readCount: async () => ({ total: 1001 }),
  now: () => 3_600_001,
  reportCleanupFailure: () => undefined,
  reportRetentionThreshold: (total, maximum) => { retentionWarningList.push([total, maximum]); },
});
const cleanupResult = await repository.addLog('LOGIN_SUCCESS');
assert.equal(executeCount, 1, 'append-only audit storage must never delete retained records');
assert.deepEqual(cleanupResult, { cleanup: 'succeeded' });
assert.deepEqual(retentionWarningList, [[1001, 1000]]);

await assert.rejects(
  service.logActionOrThrow('USER_DELETED', { targetUserId: 7 }),
  error => error === writeError,
);

console.log('audit failure policy behavior ok');

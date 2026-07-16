import assert from 'node:assert/strict';

import { runWithAuditContext, setAuditActor } from '../audit/audit-context';
import { createLogger } from '../logging/logger';

const outputList: string[] = [];
const logger = createLogger('SecurityTest', {
  production: true,
  now: () => new Date('2026-07-13T12:00:00.000Z'),
  write: (_level, line) => outputList.push(line),
});
logger.info('request accepted', {
  requestId: 'req-1',
  token: 'secret-token',
  nested: { password: 'secret-password', safe: 'value' },
  encrypted_password: 'encrypted-password',
  encrypted_private_key: 'encrypted-private-key',
  encrypted_passphrase: 'encrypted-passphrase',
  error: new Error('request failed with authorization=Bearer top-secret'),
});

const record = JSON.parse(outputList[0]);
assert.equal(record.timestamp, '2026-07-13T12:00:00.000Z');
assert.equal(record.level, 'info');
assert.equal(record.component, 'SecurityTest');
assert.equal(record.context.requestId, 'req-1');
assert.equal(record.context.token, '[REDACTED]');
assert.equal(record.context.nested.password, '[REDACTED]');
assert.equal(record.context.nested.safe, 'value');
assert.equal(record.context.encrypted_password, '[REDACTED]');
assert.equal(record.context.encrypted_private_key, '[REDACTED]');
assert.equal(record.context.encrypted_passphrase, '[REDACTED]');
assert.doesNotMatch(record.context.error.message, /top-secret/);

await runWithAuditContext({ requestId: 'req-trace-1', sourceIp: '10.0.0.1' }, async () => {
  setAuditActor({ userId: 7, username: 'operator', systemRole: 'admin' });
  logger.info('correlated request');
});
const correlatedRecord = JSON.parse(outputList[1]);
assert.equal(correlatedRecord.requestId, 'req-trace-1');
assert.equal(correlatedRecord.actorUserId, 7);
assert.equal(correlatedRecord.actorRole, 'admin');

console.log('structured logger behavior ok');

import assert from 'node:assert/strict';

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

console.log('structured logger behavior ok');

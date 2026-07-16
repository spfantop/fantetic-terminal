import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createGatewayLogger } from '../logging';

const output: string[] = [];
const logger = createGatewayLogger('GatewayTest', (_level, line) => output.push(line));
logger.error('token generation failed', {
  password: 'secret',
  nested: { authorization: 'Bearer token' },
  error: new Error('gateway authorization=Bearer top-secret'),
  requestId: 'req-gateway-1',
  safe: 'value',
});
const record = JSON.parse(output[0]);
assert.equal(record.level, 'error');
assert.equal(record.component, 'GatewayTest');
assert.equal(record.requestId, 'req-gateway-1');
assert.equal(record.context.requestId, undefined);
assert.equal(record.context.password, '[REDACTED]');
assert.equal(record.context.nested.authorization, '[REDACTED]');
assert.doesNotMatch(record.context.error.message, /top-secret/);
assert.equal(record.context.safe, 'value');

const server = readFileSync(resolve('src/server.ts'), 'utf8');
assert.doesNotMatch(server, /\bconsole\.(?:log|info|warn|error|debug)\b/);
assert.match(server, /const logger = createGatewayLogger\('RemoteGateway'\)/);
assert.match(server, /function readGatewayRequestId/);
assert.match(server, /const requestId = readGatewayRequestId\(req\)/);
assert.match(server, /requestId \? \{ requestId \} : \{\}/);
console.log('gateway structured logger behavior passed');

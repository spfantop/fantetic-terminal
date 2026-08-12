import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { createHealthHandlers } from '../health/health.controller';
import { createElectronRuntimeReadinessProof } from '../security/electron-runtime-nonce';

const createResponse = () => ({
  statusCode: 200,
  body: undefined as unknown,
  headers: {} as Record<string, string>,
  status(code: number) { this.statusCode = code; return this; },
  setHeader(name: string, value: string) { this.headers[name] = value; return this; },
  json(body: unknown) { this.body = body; return this; },
});

const checkCallList: string[] = [];
const healthy = createHealthHandlers({
  checkDatabase: async () => { checkCallList.push('database'); },
  checkDisk: async () => { checkCallList.push('disk'); },
  checkBackupDirectory: async () => { checkCallList.push('backup'); },
  createRuntimeReadinessProof: headers => headers['x-fantetic-readiness-challenge'] === 'challenge'
    ? 'runtime-proof'
    : undefined,
});
const liveResponse = createResponse();
healthy.live({} as any, liveResponse as any);
assert.deepEqual(liveResponse.body, { status: 'live' });

const readyResponse = createResponse();
await healthy.ready({ headers: { 'x-fantetic-readiness-challenge': 'challenge' } } as any, readyResponse as any);
assert.equal(readyResponse.statusCode, 200);
assert.equal(readyResponse.headers['x-fantetic-readiness-proof'], 'runtime-proof');
assert.deepEqual(readyResponse.body, {
  status: 'ready',
  checks: { database: 'ready', disk: 'ready', backup: 'ready' },
});
assert.deepEqual(checkCallList, ['database', 'disk', 'backup']);

const runtimeNonce = 'test-electron-runtime-nonce';
const challenge = 'a'.repeat(64);
assert.equal(
  createElectronRuntimeReadinessProof({ 'x-fantetic-readiness-challenge': challenge }, runtimeNonce),
  createHmac('sha256', runtimeNonce).update(challenge).digest('hex'),
);
assert.equal(createElectronRuntimeReadinessProof({}, runtimeNonce), undefined);
assert.equal(createElectronRuntimeReadinessProof({ 'x-fantetic-readiness-challenge': 'short' }, runtimeNonce), undefined);

const unavailable = createHealthHandlers({
  checkDatabase: async () => undefined,
  checkDisk: async () => { throw new Error('disk unavailable'); },
  checkBackupDirectory: async () => undefined,
});
const unavailableResponse = createResponse();
await unavailable.ready({} as any, unavailableResponse as any);
assert.equal(unavailableResponse.statusCode, 503);
assert.deepEqual(unavailableResponse.body, { code: 'health.notReady' });

console.log('health endpoint behavior passed');

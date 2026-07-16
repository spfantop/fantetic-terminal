import assert from 'node:assert/strict';

import { createHealthHandlers } from '../health/health.controller';

const createResponse = () => ({
  statusCode: 200,
  body: undefined as unknown,
  status(code: number) { this.statusCode = code; return this; },
  json(body: unknown) { this.body = body; return this; },
});

const checkCallList: string[] = [];
const healthy = createHealthHandlers({
  checkDatabase: async () => { checkCallList.push('database'); },
  checkDisk: async () => { checkCallList.push('disk'); },
  checkBackupDirectory: async () => { checkCallList.push('backup'); },
});
const liveResponse = createResponse();
healthy.live({} as any, liveResponse as any);
assert.deepEqual(liveResponse.body, { status: 'live' });

const readyResponse = createResponse();
await healthy.ready({} as any, readyResponse as any);
assert.equal(readyResponse.statusCode, 200);
assert.deepEqual(readyResponse.body, {
  status: 'ready',
  checks: { database: 'ready', disk: 'ready', backup: 'ready' },
});
assert.deepEqual(checkCallList, ['database', 'disk', 'backup']);

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

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ENCRYPTION_KEY = '33'.repeat(32);

const { createSessionRecorder, readRecordingEventPage, readRecordingEvents, verifyRecordingIntegrity } = await import('../session-recording/session-recorder');

const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-recording-test-'));
const completed: Array<{
  eventCount: number;
  byteCount: number;
  incomplete: boolean;
  batchCount: number;
  finalHash: string | null;
}> = [];
const recorder = createSessionRecorder({
  rootPath,
  recordingId: 'recording-1',
  startedAt: 1_000,
  flushIntervalMs: 5,
  maxPendingBytes: 1024,
  onComplete: async summary => completed.push(summary),
});

recorder.recordOutput(Buffer.from('hello'));
recorder.recordInput(Buffer.from('ls\r'));
recorder.recordResize(120, 40);
recorder.recordGuacamoleClient(Buffer.from('4.sync,1.a;'));
recorder.recordGuacamoleServer(Buffer.from('5.ready,1.b;'));
await recorder.finish(1_250);

const eventList = await readRecordingEvents(rootPath, recorder.relativePath);
assert.deepEqual(eventList, [
  { offsetMs: 0, type: 'output', data: Buffer.from('hello').toString('base64') },
  { offsetMs: 0, type: 'input', data: Buffer.from('ls\r').toString('base64') },
  { offsetMs: 0, type: 'resize', cols: 120, rows: 40 },
  { offsetMs: 0, type: 'guacamole-client', data: Buffer.from('4.sync,1.a;').toString('base64') },
  { offsetMs: 0, type: 'guacamole-server', data: Buffer.from('5.ready,1.b;').toString('base64') },
]);
assert.equal(completed.length, 1);
assert.equal(completed[0].eventCount, 5);
assert.equal(completed[0].incomplete, false);
assert.ok(completed[0].byteCount > 0);
assert.equal(completed[0].batchCount, 1);
assert.match(completed[0].finalHash ?? '', /^[a-f0-9]{64}$/);
assert.deepEqual(await readRecordingEventPage(rootPath, recorder.relativePath, 0, 1), {
  eventList,
  nextCursor: null,
});
const { decrypt, encrypt } = await import('../utils/crypto');
assert.deepEqual(await verifyRecordingIntegrity(rootPath, recorder.relativePath), {
  status: 'valid',
  eventCount: 5,
  batchCount: 1,
  finalHash: completed[0].finalHash,
});

const recordingPath = path.resolve(rootPath, recorder.relativePath);
const encryptedBatch = fs.readFileSync(recordingPath, 'utf8').trim();
const tamperedBatch = JSON.parse(decrypt(encryptedBatch));
tamperedBatch.hash = '0'.repeat(64);
fs.writeFileSync(recordingPath, `${encrypt(JSON.stringify(tamperedBatch))}\n`);
assert.deepEqual(await verifyRecordingIntegrity(rootPath, recorder.relativePath), {
  status: 'invalid',
  eventCount: 5,
  batchCount: 1,
  finalHash: null,
  reason: 'hash-mismatch',
});

const chainedRecorder = createSessionRecorder({
  rootPath,
  recordingId: 'recording-chain',
  startedAt: 1_500,
  flushIntervalMs: 1,
  onComplete: async summary => completed.push(summary),
});
chainedRecorder.recordOutput(Buffer.from('first batch'));
await new Promise(resolve => setTimeout(resolve, 10));
chainedRecorder.recordOutput(Buffer.from('second batch'));
await chainedRecorder.finish(1_550);
const chainedPath = path.resolve(rootPath, chainedRecorder.relativePath);
const chainedLineList = fs.readFileSync(chainedPath, 'utf8').trim().split('\n');
assert.equal(chainedLineList.length, 2, 'the test recording should have separate encrypted batches');
fs.writeFileSync(chainedPath, `${chainedLineList[1]}\n`);
assert.deepEqual(await verifyRecordingIntegrity(rootPath, chainedRecorder.relativePath), {
  status: 'invalid',
  eventCount: 1,
  batchCount: 1,
  finalHash: null,
  reason: 'previous-hash-mismatch',
});

const legacyRelativePath = path.join('legacy', 'recording.jsonl.enc');
const legacyPath = path.resolve(rootPath, legacyRelativePath);
fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
fs.writeFileSync(legacyPath, `${encrypt(JSON.stringify([{ offsetMs: 0, type: 'output', data: 'bGVnYWN5' }]))}\n`);
assert.deepEqual(await readRecordingEvents(rootPath, legacyRelativePath), [
  { offsetMs: 0, type: 'output', data: 'bGVnYWN5' },
]);
assert.deepEqual(await verifyRecordingIntegrity(rootPath, legacyRelativePath), {
  status: 'legacy',
  eventCount: 1,
  batchCount: 1,
  finalHash: null,
});

const overflow = createSessionRecorder({
  rootPath,
  recordingId: 'recording-overflow',
  startedAt: 2_000,
  flushIntervalMs: 60_000,
  maxPendingBytes: 4,
  onComplete: async summary => completed.push(summary),
});
overflow.recordOutput(Buffer.from('12345'));
await overflow.finish(2_100);
assert.equal(completed[2].incomplete, true);
assert.equal(completed[2].eventCount, 0);
assert.equal(completed[2].batchCount, 0);
assert.equal(completed[2].finalHash, null);

fs.rmSync(rootPath, { recursive: true, force: true });
console.log('session recording behavior ok');

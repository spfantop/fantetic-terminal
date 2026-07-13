import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ENCRYPTION_KEY = '33'.repeat(32);

const { createSessionRecorder, readRecordingEventPage, readRecordingEvents } = await import('../session-recording/session-recorder');

const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-recording-test-'));
const completed: Array<{ eventCount: number; byteCount: number; incomplete: boolean }> = [];
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
await recorder.finish(1_250);

const eventList = await readRecordingEvents(rootPath, recorder.relativePath);
assert.deepEqual(eventList, [
  { offsetMs: 0, type: 'output', data: Buffer.from('hello').toString('base64') },
  { offsetMs: 0, type: 'input', data: Buffer.from('ls\r').toString('base64') },
  { offsetMs: 0, type: 'resize', cols: 120, rows: 40 },
]);
assert.equal(completed.length, 1);
assert.equal(completed[0].eventCount, 3);
assert.equal(completed[0].incomplete, false);
assert.ok(completed[0].byteCount > 0);
assert.deepEqual(await readRecordingEventPage(rootPath, recorder.relativePath, 0, 1), {
  eventList,
  nextCursor: null,
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
assert.equal(completed[1].incomplete, true);
assert.equal(completed[1].eventCount, 0);

fs.rmSync(rootPath, { recursive: true, force: true });
console.log('session recording behavior ok');

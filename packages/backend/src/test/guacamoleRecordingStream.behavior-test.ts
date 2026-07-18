import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ENCRYPTION_KEY = '44'.repeat(32);

const {
  createSessionRecorder,
  readGuacamoleServerRecordingChunks,
} = await import('../session-recording/session-recorder');

const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-guacamole-recording-test-'));
const recorder = createSessionRecorder({
  rootPath,
  recordingId: 'guacamole-recording',
  startedAt: 1_000,
  onComplete: async () => {},
});
recorder.recordGuacamoleClient(Buffer.from('4.sync,1.a;'));
recorder.recordGuacamoleClient(Buffer.from('5.mouse,2.12,2.34,1.0;'));
recorder.recordGuacamoleClient(Buffer.from('3.key,2.65,1.1;'));
recorder.recordGuacamoleServer(Buffer.from('5.ready,1.b;'));
recorder.recordGuacamoleServer(Buffer.from('4.sync,1.c;'));
await recorder.finish(1_100);

const chunkList: Buffer[] = [];
for await (const chunk of readGuacamoleServerRecordingChunks(rootPath, recorder.relativePath)) {
  chunkList.push(chunk);
}
assert.deepEqual(
  chunkList.map(chunk => chunk.toString('utf8')),
  ['5.mouse,2.12,2.34;', '5.ready,1.b;', '4.sync,1.c;'],
  'playback must retain pointer coordinates without replaying client keyboard or button input',
);

const routes = fs.readFileSync(path.resolve('src/session-recording/session-recording.routes.ts'), 'utf8');
const controller = fs.readFileSync(path.resolve('src/session-recording/session-recording.controller.ts'), 'utf8');
const service = fs.readFileSync(path.resolve('src/session-recording/session-recording.service.ts'), 'utf8');
assert.match(routes, /router\.get\('\/:recordingId\/guacamole'/);
assert.match(controller, /streamGuacamoleRecording/);
assert.match(service, /prepareGuacamoleRecordingStreamForSubject/);
assert.match(service, /readGuacamoleServerRecordingChunks/);

fs.rmSync(rootPath, { recursive: true, force: true });
console.log('guacamole recording stream behavior ok');

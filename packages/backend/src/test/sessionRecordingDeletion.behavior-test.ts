import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const routes = readFileSync(resolve('src/session-recording/session-recording.routes.ts'), 'utf8');
const service = readFileSync(resolve('src/session-recording/session-recording.service.ts'), 'utf8');
const repository = readFileSync(resolve('src/session-recording/session-recording.repository.ts'), 'utf8');

assert.match(routes, /router\.delete\('\/:recordingId'/);
assert.match(service, /deleteRecordingForSubject/);
assert.match(service, /status === 'active'/);
assert.match(repository, /deleteSessionRecording/);
assert.match(repository, /DELETE FROM session_recordings/);
console.log('session recording deletion behavior ok');

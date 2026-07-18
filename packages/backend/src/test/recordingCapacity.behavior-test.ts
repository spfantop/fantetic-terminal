import assert from 'node:assert/strict';

import {
  isRecordingPathInsideRoot,
  resolveRecordingCapacityConfig,
  selectRecordingsForPrune,
} from '../session-recording/recording-capacity';

const day = 24 * 60 * 60 * 1000;
const now = 200 * day;

assert.deepEqual(resolveRecordingCapacityConfig({
  RECORDING_RETENTION_DAYS: '30',
  RECORDING_MAX_TOTAL_BYTES: '100',
  RECORDING_MIN_FREE_BYTES: '50',
}), {
  retentionDays: 30,
  maxTotalBytes: 100,
  minimumFreeBytes: 50,
});
assert.deepEqual(resolveRecordingCapacityConfig({
  RECORDING_RETENTION_DAYS: '-1',
  RECORDING_MAX_TOTAL_BYTES: 'invalid',
  RECORDING_MIN_FREE_BYTES: '',
}), {
  retentionDays: 0,
  maxTotalBytes: 0,
  minimumFreeBytes: 512 * 1024 * 1024,
});

const recordingList = [
  { id: 'active', status: 'active' as const, endedAt: null, byteCount: 100, relativePath: 'active' },
  { id: 'expired', status: 'completed' as const, endedAt: now - 31 * day, byteCount: 40, relativePath: 'expired' },
  { id: 'oldest', status: 'completed' as const, endedAt: now - 2 * day, byteCount: 70, relativePath: 'oldest' },
  { id: 'newest', status: 'completed' as const, endedAt: now - day, byteCount: 70, relativePath: 'newest' },
];
assert.deepEqual(
  selectRecordingsForPrune(recordingList, resolveRecordingCapacityConfig({}), now),
  [],
  'defaults must never delete recordings',
);
assert.deepEqual(selectRecordingsForPrune(recordingList, resolveRecordingCapacityConfig({
  RECORDING_RETENTION_DAYS: '30',
  RECORDING_MAX_TOTAL_BYTES: '100',
}), now).map(recording => recording.id), ['expired', 'oldest']);

assert.equal(isRecordingPathInsideRoot('/data/recordings', 'recording-1/events.log'), true);
assert.equal(isRecordingPathInsideRoot('/data/recordings', '../database.sqlite'), false);
assert.equal(isRecordingPathInsideRoot('/data/recordings', '/etc/passwd'), false);
assert.equal(isRecordingPathInsideRoot('/data/recordings', '.'), false);

console.log('recording capacity behavior passed');

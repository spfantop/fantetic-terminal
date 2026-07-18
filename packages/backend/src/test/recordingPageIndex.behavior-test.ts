import assert from 'node:assert/strict';

import { createRecordingPageIndexCache } from '../session-recording/recording-page-index';

let fingerprint = 'fingerprint-1';
const cache = createRecordingPageIndexCache({
  readFingerprint: async () => fingerprint,
  maxEntries: 2,
});

const firstIndex = await cache.open('root', 'recording-a');
assert.deepEqual(firstIndex.find(100), { lineIndex: 0, byteOffset: 0 });
firstIndex.remember(100, 4_096);
firstIndex.remember(200, 8_192);
assert.deepEqual(firstIndex.find(150), { lineIndex: 100, byteOffset: 4_096 });
assert.deepEqual(firstIndex.find(200), { lineIndex: 200, byteOffset: 8_192 });

fingerprint = 'fingerprint-2';
const changedIndex = await cache.open('root', 'recording-a');
assert.deepEqual(
  changedIndex.find(200),
  { lineIndex: 0, byteOffset: 0 },
  'file changes must invalidate stale byte offsets',
);

const limitedCache = createRecordingPageIndexCache({
  readFingerprint: async () => 'stable',
  maxCheckpointsPerEntry: 3,
});
const limitedIndex = await limitedCache.open('root', 'recording-limited');
limitedIndex.remember(100, 1_000);
limitedIndex.remember(200, 2_000);
limitedIndex.remember(300, 3_000);
assert.deepEqual(
  limitedIndex.find(150),
  { lineIndex: 0, byteOffset: 0 },
  'old checkpoints must be evicted without removing the file-start checkpoint',
);

console.log('recording page index behavior passed');

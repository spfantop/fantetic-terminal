import assert from 'node:assert/strict';

import { createRecordingIntegrityCache } from '../session-recording/recording-integrity-cache';
import type { RecordingIntegrityResult } from '../session-recording/session-recorder';

const validResult: RecordingIntegrityResult = {
  status: 'valid',
  eventCount: 4,
  batchCount: 2,
  finalHash: 'a'.repeat(64),
};
let fingerprint = 'fingerprint-1';
let verificationCount = 0;
let waitForRelease = false;
let releaseVerification: (() => void) | undefined;
const cache = createRecordingIntegrityCache({
  readFingerprint: async () => fingerprint,
  verify: async () => {
    verificationCount += 1;
    if (waitForRelease) {
      await new Promise<void>(resolve => {
        releaseVerification = resolve;
      });
    }
    return validResult;
  },
  maxEntries: 2,
});

assert.equal(await cache.verify('root', 'recording-a'), validResult);
assert.equal(await cache.verify('root', 'recording-a'), validResult);
assert.equal(verificationCount, 1, 'unchanged recordings should reuse their integrity result');

fingerprint = 'fingerprint-2';
assert.equal(await cache.verify('root', 'recording-a'), validResult);
assert.equal(verificationCount, 2, 'a changed file fingerprint must invalidate the cached result');

fingerprint = 'fingerprint-3';
waitForRelease = true;
const firstConcurrentVerification = cache.verify('root', 'recording-a');
const secondConcurrentVerification = cache.verify('root', 'recording-a');
await Promise.resolve();
await Promise.resolve();
assert.equal(verificationCount, 3, 'concurrent requests must share one integrity verification');
releaseVerification?.();
await Promise.all([firstConcurrentVerification, secondConcurrentVerification]);

waitForRelease = false;
await cache.verify('root', 'recording-b');
await cache.verify('root', 'recording-c');
const verificationCountBeforeEvictedRead = verificationCount;
await cache.verify('root', 'recording-a');
assert.equal(
  verificationCount,
  verificationCountBeforeEvictedRead + 1,
  'the cache must evict its least-recently-used entry at the configured limit',
);

console.log('recording integrity cache behavior passed');

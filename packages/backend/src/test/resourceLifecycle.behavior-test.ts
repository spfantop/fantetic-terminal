import assert from 'node:assert/strict';

import { createKeyedRunOnce } from '../utils/keyed-run-once';

let executionCount = 0;
let release: (() => void) | undefined;
const barrier = new Promise<void>(resolve => { release = resolve; });
const runOnce = createKeyedRunOnce(async (_key: string) => {
  executionCount += 1;
  await barrier;
  return executionCount;
});

const first = runOnce('session-1');
const second = runOnce('session-1');
assert.equal(first, second);
assert.equal(executionCount, 1);
release?.();
assert.equal(await first, 1);
assert.equal(await runOnce('session-1'), 2, 'completed keys must be released');

console.log('resource lifecycle behavior ok');

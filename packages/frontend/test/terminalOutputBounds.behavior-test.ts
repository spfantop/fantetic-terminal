import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appendToBoundedQueue } from '../src/utils/boundedTerminalOutput';

const queue = ['1234', '5678'];
const result = appendToBoundedQueue(queue, 'abcd', 8, {
  maxBytes: 10,
  measure: value => value.length,
});

assert.deepEqual(queue, ['5678', 'abcd']);
assert.equal(result.pendingBytes, 8);
assert.equal(result.droppedBytes, 4);
assert.equal(result.accepted, true);

const oversizedQueue = ['old'];
const oversized = appendToBoundedQueue(oversizedQueue, '01234567890', 3, {
  maxBytes: 10,
  measure: value => value.length,
});

assert.deepEqual(oversizedQueue, []);
assert.equal(oversized.pendingBytes, 0);
assert.equal(oversized.droppedBytes, 14);
assert.equal(oversized.accepted, false);

const terminalSessionLifecycle = readFileSync(resolve('src/stores/session/terminal-session-lifecycle.ts'), 'utf8');
assert.match(terminalSessionLifecycle, /SSH_OUTPUT_CACHED_CHUNK[\s\S]*terminalManager\.writeOutput\(result\.data\)/);
assert.doesNotMatch(terminalSessionLifecycle, /pendingOutput\.push\(result\.data\)/);

console.log('terminal output bounds behavior ok');

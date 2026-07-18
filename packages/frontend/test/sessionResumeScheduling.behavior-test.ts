import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ref } from 'vue';

import { createSingleFlight, waitForRefValue } from '../src/utils/asyncScheduling';

let taskRunCount = 0;
let resolveTask: ((value: number) => void) | null = null;
const runTask = createSingleFlight(() => {
  taskRunCount += 1;
  return new Promise<number>((resolveTaskPromise) => {
    resolveTask = resolveTaskPromise;
  });
});

const firstRun = runTask();
const sharedRun = runTask();
assert.equal(firstRun, sharedRun, 'overlapping calls must share the same promise');
assert.equal(taskRunCount, 1, 'overlapping calls must execute the task once');
resolveTask?.(1);
assert.equal(await firstRun, 1);
await Promise.resolve();

const nextRun = runTask();
assert.notEqual(nextRun, firstRun, 'a completed task must allow a new run');
assert.equal(taskRunCount, 2);
resolveTask?.(2);
await nextRun;

const connected = ref(false);
const connectedResult = waitForRefValue(connected, value => value, 100);
connected.value = true;
assert.equal(await connectedResult, true, 'reactive connection changes must resolve without polling');

const disconnected = ref(false);
assert.equal(
  await waitForRefValue(disconnected, value => value, 5),
  false,
  'connection wait must stop at its timeout',
);

const actionSource = readFileSync(
  resolve(import.meta.dirname, '..', 'packages/frontend/src/stores/session/actions/sshSuspendActions.ts'),
  'utf8',
);
assert.match(actionSource, /createSingleFlight/, 'suspended-session refresh must use single-flight');
assert.match(actionSource, /waitForRefValue/, 'session resume must wait reactively for WebSocket connection');
assert.doesNotMatch(actionSource, /MAX_WAIT_ITERATIONS/, 'session resume must not use timer polling');

const viewSource = readFileSync(
  resolve(import.meta.dirname, '..', 'packages/frontend/src/views/SuspendedSshSessionsView.vue'),
  'utf8',
);
assert.match(viewSource, /document\.visibilityState === 'visible'/, 'hidden pages must skip background refresh');
assert.match(viewSource, /visibilitychange/, 'returning to the page must refresh suspended sessions');

console.log('session resume scheduling behavior passed');

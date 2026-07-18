import assert from 'node:assert/strict';

import { createConnectionPollingCoordinator } from '../services/status-monitor-polling';

const scheduledCallbacks: Array<() => void> = [];
const clearedTimers: unknown[] = [];
const pollList: Array<{ connectionId: number; sessionIdList: string[] }> = [];
const emptyConnectionList: number[] = [];
const coordinator = createConnectionPollingCoordinator({
  poll: async (connectionId, sessionIdList) => {
    pollList.push({ connectionId, sessionIdList: [...sessionIdList] });
  },
  setInterval: (callback) => {
    scheduledCallbacks.push(callback);
    return { index: scheduledCallbacks.length - 1 } as unknown as NodeJS.Timeout;
  },
  clearInterval: timer => {
    clearedTimers.push(timer);
  },
  onConnectionEmpty: connectionId => {
    emptyConnectionList.push(connectionId);
  },
});

coordinator.join(7, 'session-a', 3_000);
await Promise.resolve();
assert.equal(scheduledCallbacks.length, 1);
assert.deepEqual(pollList, [{ connectionId: 7, sessionIdList: ['session-a'] }]);

coordinator.join(7, 'session-b', 3_000);
coordinator.join(7, 'session-b', 3_000);
await Promise.resolve();
assert.equal(scheduledCallbacks.length, 1, 'one managed connection must own one polling timer');

scheduledCallbacks[0]?.();
await Promise.resolve();
assert.deepEqual(pollList.at(-1), {
  connectionId: 7,
  sessionIdList: ['session-a', 'session-b'],
});

coordinator.leave('session-a');
scheduledCallbacks[0]?.();
await Promise.resolve();
assert.deepEqual(pollList.at(-1), {
  connectionId: 7,
  sessionIdList: ['session-b'],
});
assert.equal(clearedTimers.length, 0);

coordinator.leave('session-b');
assert.equal(clearedTimers.length, 1);
assert.deepEqual(emptyConnectionList, [7]);
assert.equal(coordinator.hasSession('session-b'), false);
const pollCountAfterConnectionEmptied = pollList.length;
scheduledCallbacks[0]?.();
await Promise.resolve();
assert.equal(
  pollList.length,
  pollCountAfterConnectionEmptied,
  'a queued timer callback must not poll after its connection group is empty',
);

coordinator.join(8, 'session-c', 3_000);
coordinator.join(9, 'session-d', 3_000);
await Promise.resolve();
assert.equal(scheduledCallbacks.length, 3, 'different managed connections need independent timers');

coordinator.dispose();
assert.equal(clearedTimers.length, 3);
assert.deepEqual(emptyConnectionList, [7, 8, 9]);

console.log('status monitor polling behavior passed');

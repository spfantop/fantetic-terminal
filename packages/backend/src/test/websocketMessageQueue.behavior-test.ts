import assert from 'node:assert/strict';

import { BoundedTaskQueue } from '../websocket/bounded-task-queue';

let releaseFirst!: () => void;
const firstTask = new Promise<void>(resolve => { releaseFirst = resolve; });
const executionList: string[] = [];
const queue = new BoundedTaskQueue({ maxTasks: 2, maxBytes: 10 });

assert.equal(queue.enqueue(6, async () => { executionList.push('first'); await firstTask; }), true);
assert.equal(queue.enqueue(4, async () => { executionList.push('second'); }), true);
assert.equal(queue.enqueue(1, async () => { executionList.push('overflow'); }), false);
await Promise.resolve();
assert.deepEqual(executionList, ['first']);
releaseFirst();
await queue.onIdle();
assert.deepEqual(executionList, ['first', 'second']);
assert.equal(queue.pendingBytes, 0);
assert.equal(queue.pendingTasks, 0);

console.log('websocket message queue behavior ok');

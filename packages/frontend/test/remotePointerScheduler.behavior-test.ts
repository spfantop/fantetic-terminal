import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createRemotePointerScheduler } from '../src/utils/remotePointerScheduler';

const frameCallbacks = new Map<number, FrameRequestCallback>();
const canceledFrameList: number[] = [];
const sentStateList: Array<{ x: number; y: number; left?: boolean }> = [];
let nextFrameId = 1;
const scheduler = createRemotePointerScheduler({
  send: state => sentStateList.push(state),
  animationFrame: {
    requestAnimationFrame: callback => {
      const frameId = nextFrameId++;
      frameCallbacks.set(frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: frameId => {
      canceledFrameList.push(frameId);
      frameCallbacks.delete(frameId);
    },
  },
});

scheduler.move({ x: 1, y: 1 });
scheduler.move({ x: 2, y: 2 });
scheduler.move({ x: 3, y: 3 });
assert.equal(frameCallbacks.size, 1, 'pointer movement should schedule at most one frame');
assert.deepEqual(sentStateList, []);

const [firstFrameId, firstFrame] = [...frameCallbacks.entries()][0];
frameCallbacks.delete(firstFrameId);
firstFrame(16);
assert.deepEqual(sentStateList, [{ x: 3, y: 3 }], 'one frame should send only the latest pointer position');

scheduler.move({ x: 4, y: 4 });
scheduler.sendNow({ x: 4, y: 4, left: true });
assert.deepEqual(sentStateList.slice(-2), [
  { x: 4, y: 4 },
  { x: 4, y: 4, left: true },
], 'button events must flush pending movement before sending immediately');
assert.equal(canceledFrameList.length, 1);

const mutableState = { x: 5, y: 5 };
scheduler.move(mutableState);
mutableState.x = 99;
const [snapshotFrameId, snapshotFrame] = [...frameCallbacks.entries()][0];
frameCallbacks.delete(snapshotFrameId);
snapshotFrame(32);
assert.deepEqual(sentStateList.at(-1), { x: 5, y: 5 }, 'queued pointer state must be snapshotted');

scheduler.move({ x: 6, y: 6 });
scheduler.dispose();
assert.equal(frameCallbacks.size, 0);
assert.notDeepEqual(sentStateList.at(-1), { x: 6, y: 6 }, 'dispose must discard queued movement');

for (const componentPath of [
  'src/components/RemoteDesktopSession.vue',
  'src/components/RemoteDesktopModal.vue',
  'src/components/VncModal.vue',
]) {
  const source = readFileSync(resolve(import.meta.dirname, '..', 'packages/frontend', componentPath), 'utf8');
  assert.match(source, /createRemotePointerScheduler/, `${componentPath} must use the shared pointer scheduler`);
  assert.match(source, /pointerScheduler\.move\(mouseState\)/, `${componentPath} must coalesce pointer movement`);
  assert.match(source, /pointerScheduler\.sendNow\(mouseState\)/, `${componentPath} must send button state immediately`);
  assert.match(source, /pointerScheduler\.dispose/, `${componentPath} must dispose queued pointer work`);
}

console.log('remote pointer scheduler behavior passed');

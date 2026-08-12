import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  closeWebSocketRuntime,
  createWebSocketRuntimeLifecycle,
  WebSocketRuntimeDrainError,
} from '../websocket/runtime-lifecycle';

const cleanedSessionIdList: string[] = [];
const releaseMap = new Map<string, () => void>();
let stopHeartbeatCount = 0;
let disposeStatusMonitorCount = 0;

const lifecycle = createWebSocketRuntimeLifecycle({
  listSessionIds: () => ['session-a', 'session-b'],
  cleanupSession: sessionId => new Promise<void>(resolve => {
    cleanedSessionIdList.push(sessionId);
    releaseMap.set(sessionId, resolve);
  }),
  stopHeartbeat: () => { stopHeartbeatCount += 1; },
  disposeStatusMonitor: () => { disposeStatusMonitorCount += 1; },
});

const firstDrain = lifecycle.drain();
const repeatedDrain = lifecycle.drain();
assert.equal(firstDrain, repeatedDrain, 'repeated drain calls must share one promise');
assert.deepEqual(cleanedSessionIdList, ['session-a', 'session-b']);
assert.equal(stopHeartbeatCount, 1);
assert.equal(disposeStatusMonitorCount, 1);

let settled = false;
void firstDrain.finally(() => { settled = true; });
await Promise.resolve();
assert.equal(settled, false, 'drain must wait for every session cleanup');
releaseMap.get('session-a')?.();
await Promise.resolve();
assert.equal(settled, false, 'one completed cleanup must not finish the drain');
releaseMap.get('session-b')?.();
await firstDrain;
assert.equal(settled, true);

const attemptedSessionIdList: string[] = [];
const failingLifecycle = createWebSocketRuntimeLifecycle({
  listSessionIds: () => ['failed-session', 'healthy-session'],
  cleanupSession: async sessionId => {
    attemptedSessionIdList.push(sessionId);
    if (sessionId === 'failed-session') throw new Error('cleanup failed');
  },
  stopHeartbeat: () => undefined,
  disposeStatusMonitor: () => undefined,
});
await assert.rejects(failingLifecycle.drain(), WebSocketRuntimeDrainError);
assert.deepEqual(attemptedSessionIdList, ['failed-session', 'healthy-session']);

const closeEventList: string[] = [];
await assert.rejects(closeWebSocketRuntime({
  clients: [{ terminate: () => { closeEventList.push('terminate'); } }],
  drainSessions: async () => {
    closeEventList.push('drain');
    throw new Error('drain failed');
  },
  close: callback => {
    closeEventList.push('close');
    callback();
  },
}), /drain failed/);
assert.deepEqual(closeEventList, ['terminate', 'drain', 'close']);

const websocketSource = readFileSync('src/websocket.ts', 'utf8');
assert.doesNotMatch(websocketSource, /new SftpService/);
assert.match(websocketSource, /clientStates, sftpService, statusMonitorService/);

console.log('websocket runtime lifecycle behavior ok');

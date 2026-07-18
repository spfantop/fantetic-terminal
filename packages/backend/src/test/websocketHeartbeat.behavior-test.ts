import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { initializeHeartbeat } from '../websocket/heartbeat';

class FakeSocket {
  isAlive = false;
  missedHeartbeatCount = 0;
  username = 'heartbeat-user';
  sessionId = 'heartbeat-session';
  pingCount = 0;
  terminateCount = 0;

  ping(callback: () => void): void {
    this.pingCount += 1;
    callback();
  }

  terminate(): void {
    this.terminateCount += 1;
    server.clients.delete(this);
  }
}

const server = new EventEmitter() as EventEmitter & { clients: Set<FakeSocket> };
const socket = new FakeSocket();
server.clients = new Set([socket]);
const cleanedSessionIdList: string[] = [];
let heartbeatCycle: (() => void) | undefined;
let cancelled = false;

const heartbeat = initializeHeartbeat(server as never, {
  cleanupClientConnection: sessionId => {
    if (sessionId) cleanedSessionIdList.push(sessionId);
  },
  scheduleInterval: (callback, intervalMs) => {
    assert.equal(intervalMs, 10_000);
    heartbeatCycle = callback;
    return {} as NodeJS.Timeout;
  },
  cancelInterval: () => {
    cancelled = true;
  },
});

heartbeatCycle?.();
heartbeatCycle?.();
assert.equal(socket.terminateCount, 0, 'two missed heartbeats must not terminate a connection');

heartbeatCycle?.();
assert.equal(socket.terminateCount, 1, 'the third missed heartbeat must terminate the connection');
assert.deepEqual(cleanedSessionIdList, ['heartbeat-session']);

server.emit('close');
assert.equal(cancelled, true);
void heartbeat;
console.log('websocket heartbeat behavior passed');

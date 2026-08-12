import assert from 'node:assert/strict';

import {
  runWebSocketSessionCleanup,
  WebSocketSessionCleanupError,
} from '../websocket/session-cleanup';

const eventList: string[] = [];
const sftpError = new Error('SFTP close failed');
await assert.rejects(
  runWebSocketSessionCleanup({
    clearOutput: () => { eventList.push('output'); },
    clearInput: () => { eventList.push('input'); },
    finishRecording: async () => { eventList.push('recording'); },
    stopStatusPolling: () => { eventList.push('status'); },
    cleanupSftp: () => {
      eventList.push('sftp');
      throw sftpError;
    },
    disconnectTelnet: () => { eventList.push('telnet'); },
    resolveSshOwnership: async () => { eventList.push('ssh'); },
    stopDockerPolling: () => { eventList.push('docker'); },
    detachState: () => { eventList.push('detach'); },
  }),
  error => error instanceof WebSocketSessionCleanupError && error.errors.includes(sftpError),
);
assert.deepEqual(eventList, [
  'output',
  'input',
  'recording',
  'status',
  'sftp',
  'telnet',
  'ssh',
  'docker',
  'detach',
]);

console.log('WebSocket session cleanup behavior passed');

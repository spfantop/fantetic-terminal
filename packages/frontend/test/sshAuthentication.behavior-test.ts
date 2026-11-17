import assert from 'node:assert/strict';
import { FakeWebSocket } from './support/terminal-session-runtime';
import { createWebSocketConnectionManager } from '../src/composables/useWebSocketConnection';
import { readSshAuthChallenge } from '../src/websocket/ssh-auth-challenge';

const manager = createWebSocketConnectionManager('tab1', '1', ((key: string) => key) as never);
manager.connect('ws://localhost');
const socket = FakeWebSocket.instanceList[0];
socket.open();
const challenge = { requestId: 'first', name: '', instructions: '', username: 'test', prompts: [{ prompt: 'Password:', echo: false }] };
socket.receive({ type: 'ssh:auth-prompt', payload: challenge });
assert.deepEqual(manager.authChallenge.value, challenge);
manager.respondToAuth('stale', ['no']);
assert.equal(manager.authChallenge.value?.requestId, 'first');
manager.respondToAuth('first', ['a*b']);
assert.equal(manager.authChallenge.value, null);
assert.deepEqual(JSON.parse(String(socket.sentFrameList.at(-1))), {
  type: 'ssh:auth-response', payload: { requestId: 'first', answers: ['a*b'] },
});
socket.receive({ type: 'ssh:auth-prompt', payload: { ...challenge, requestId: 'otp', prompts: [{ prompt: 'Code:', echo: false }] } });
manager.respondToAuth('otp', null);
assert.equal(manager.authChallenge.value, null);
assert.equal(socket.closeCallCount, 1);
assert.equal(manager.connectionStatus.value, 'disconnected');
assert.equal(readSshAuthChallenge({ ...challenge, prompts: [{ prompt: 'Password:', echo: 'false' }] }), null);
assert.equal(readSshAuthChallenge({ ...challenge, prompts: Array(9).fill(challenge.prompts[0]) }), null);
console.log('SSH authentication client behavior passed');

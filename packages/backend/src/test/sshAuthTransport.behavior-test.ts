import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { createSshAuthInteraction, handleSshAuthResponse } from '../websocket/ssh-authentication';

async function run() {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const connected = once(server, 'connection');
  const browser = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const [socket]: [WebSocket] = await connected as [WebSocket];
  await once(browser, 'open');
  const interaction = createSshAuthInteraction(socket, 1000);
  const challenge = { name: 'Test', instructions: '', username: 'test', prompts: [{ prompt: 'OTP', echo: false }] };
  try {
    const message = once(browser, 'message');
    const result = interaction.request(challenge);
    const [frame] = await message;
    const { payload } = JSON.parse(String(frame));
    // A response from another socket or with an old ID must not satisfy this request.
    handleSshAuthResponse(browser, { requestId: payload.requestId, answers: ['wrong-socket'] });
    handleSshAuthResponse(socket, { requestId: 'stale', answers: ['wrong-id'] });
    handleSshAuthResponse(socket, { requestId: payload.requestId, answers: ['123456'] });
    assert.deepEqual(await result, ['123456']);
    handleSshAuthResponse(socket, { requestId: payload.requestId, answers: ['replay'] });
    const timeout = interaction.request(challenge);
    await assert.rejects(timeout, /cancelled or expired/);
    assert.equal(interaction.signal.aborted, true);
  } finally {
    interaction.dispose();
    browser.terminate();
    socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  console.log('SSH authentication response isolation and timeout passed');
}
void run();

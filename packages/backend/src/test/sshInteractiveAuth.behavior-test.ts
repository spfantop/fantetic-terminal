import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { Client, Server, type ConnectConfig } from 'ssh2';
import { enableKeyboardPasswordAuth } from '../services/ssh-keyboard-auth';
import { establishSshConnection } from '../services/ssh.service';

async function run() {
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  for (const method of ['keyboard-interactive', 'password'] as const) {
    const server = new Server({ hostKeys: [hostKey] }, connection => {
      connection.on('error', () => { /* Client outcome is asserted below. */ });
      connection.on('authentication', context => {
        if (method === 'password' && context.method === 'password') {
          return context.password === 'a*b' ? context.accept() : context.reject(['password']);
        }
        if (method === 'keyboard-interactive' && context.method === 'keyboard-interactive') {
          context.prompt([{ prompt: 'Password for test: ', echo: false }], answers => {
            assert.deepEqual(answers, ['a*b']);
            context.prompt([{ prompt: 'Verification code: ', echo: false }], codes => {
              assert.deepEqual(codes, ['123456']);
              context.prompt([], empty => { assert.deepEqual(empty, []); context.accept(); });
            });
          });
          return;
        }
        context.reject([method]);
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    let promptCount = 0;
    const authentication = {
      signal: new AbortController().signal,
      request: async (challenge: { prompts: Array<{ prompt: string }> }) => {
        promptCount++;
        return challenge.prompts.map(prompt => prompt.prompt.includes('code') ? '123456' : 'a*b');
      },
    };
    let client: Client | undefined;
    try {
      client = await establishSshConnection({ id: -1, name: 'Interactive test', host: '127.0.0.1', port: address.port, username: 'test', auth_method: 'password', authentication }, 2000);
      assert.equal(promptCount, method === 'password' ? 1 : 2);
    } finally {
      client?.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
  const controller = new AbortController();
  const client = new Client();
  const config: ConnectConfig = { username: 'test' };
  enableKeyboardPasswordAuth(client, config, { signal: controller.signal, request: async () => [] });
  const cancelled = new Promise<Error>(resolve => client.once('error', resolve));
  controller.abort();
  assert.match((await cancelled).message, /cancelled/);
  console.log('SSH interactive authentication passed');
}
void run();

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { Client, Server, type ConnectConfig } from 'ssh2';
import { establishSshConnection } from '../services/ssh.service';
import { enableKeyboardPasswordAuth } from '../services/ssh-keyboard-auth';

async function run() {
  for (const prompts of [
    [{ prompt: 'Verification code: ', echo: false }],
    [{ prompt: 'New password: ', echo: false }],
    [{ prompt: 'Password: ', echo: true }],
    [{ prompt: 'Password: ', echo: false }, { prompt: 'OTP: ', echo: false }],
  ]) {
    const client = new Client();
    const config: ConnectConfig = { password: 'test*password' };
    enableKeyboardPasswordAuth(client, config);
    let answers: string[] | undefined;
    client.emit('keyboard-interactive', '', '', '', prompts, (value: string[]) => { answers = value; });
    assert.deepEqual(answers, prompts.map(() => ''));
    client.emit('close');
    assert.equal(client.listenerCount('keyboard-interactive'), 0);
  }
  const keyClient = new Client();
  const keyConfig: ConnectConfig = { privateKey: 'key' };
  enableKeyboardPasswordAuth(keyClient, keyConfig);
  assert.equal(keyConfig.tryKeyboard, undefined);
  assert.equal(keyClient.listenerCount('keyboard-interactive'), 0);
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const password = 'test*password';
  for (const mode of ['password', 'keyboard-interactive'] as const) {
    let emptyRoundCompleted = false;
    const server = new Server({ hostKeys: [hostKey] }, client => {
      client.on('error', () => { /* Failed authentication is asserted by the client promise. */ });
      client.on('authentication', context => {
        if (context.username !== 'test-user') return context.reject();
        if (mode === 'password' && context.method === 'password' && context.password === password) return context.accept();
        if (mode === 'keyboard-interactive' && context.method === 'keyboard-interactive') {
          context.prompt([{ prompt: 'Password: ', echo: false }], answers => {
            if (answers[0] !== password) return context.reject();
            context.prompt([], answers => {
              emptyRoundCompleted = answers.length === 0;
              context.accept();
            });
          });
          return;
        }
        context.reject([mode]);
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    try {
      const client = await establishSshConnection({ id: -1, name: 'authentication regression', host: '127.0.0.1', port: address.port, username: 'test-user', auth_method: 'password', password }, 3000);
      client.end();
      if (mode === 'keyboard-interactive') assert.equal(emptyRoundCompleted, true);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
  console.log('SSH keyboard authentication behavior passed');

}
void run();

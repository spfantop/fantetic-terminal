import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server, type Connection } from 'ssh2';
import { spawn, type IPty } from 'node-pty';
import { buildOpenSshArguments, openSshExecutable } from '../services/openssh.service';

async function run() {
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
    let connection: Connection | undefined;
    let authenticated = false;
    const server = new Server({ hostKeys: [key] }, client => {
        connection = client;
        client.on('error', () => { /* Exit and authentication are asserted below. */ });
        client.on('authentication', auth => {
            if (auth.method !== 'keyboard-interactive') { auth.reject(['keyboard-interactive']); return; }
            auth.prompt([{ prompt: 'Fixture password: ', echo: false }], answers => {
                assert.deepEqual(answers, ['fixture*secret']);
                auth.prompt([{ prompt: 'Fixture verification: ', echo: false }], codes => {
                    assert.deepEqual(codes, ['719243']);
                    authenticated = true;
                    auth.accept();
                });
            });
        });
        client.on('ready', () => client.on('session', accept => {
            const session = accept();
            session.on('pty', acceptPty => acceptPty?.());
            session.on('shell', acceptShell => {
                const stream = acceptShell();
                stream.write('FIXTURE_AUTHENTICATED\r\n');
                stream.on('data', (data: Buffer) => {
                    if (data.toString().includes('exit')) { stream.exit(0); stream.end(); }
                });
            });
        }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const trust = await mkdtemp(join(tmpdir(), 'fantetic-openssh-test-'));
    let terminal: IPty | undefined;
    let output = '';
    let passwordSent = false;
    let codeSent = false;
    let exitSent = false;
    try {
        const args = buildOpenSshArguments({ host: '127.0.0.1', port: address.port, username: 'fixture', auth_method: 'password' });
        args.unshift('-o', `UserKnownHostsFile="${join(trust, 'known_hosts').replace(/\\/g, '/')}"`, '-o', 'GlobalKnownHostsFile=none');
        terminal = spawn(openSshExecutable, args, { name: 'xterm-256color', cols: 100, rows: 30 });
        const pty = terminal;
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('OpenSSH fixture timeout')), 20000);
            let hostAccepted = false;
            pty.onData(data => {
                output += data;
                if (!hostAccepted && /continue connecting/i.test(output)) { hostAccepted = true; pty.write('yes\r'); }
                if (!passwordSent && output.includes('Fixture password:')) { passwordSent = true; pty.write('fixture*secret\r'); }
                if (!codeSent && output.includes('Fixture verification:')) { codeSent = true; pty.write('719243\r'); }
                if (!exitSent && output.includes('FIXTURE_AUTHENTICATED')) { exitSent = true; pty.resize(120, 40); pty.write('exit\r'); }
            });
            pty.onExit(event => { clearTimeout(timeout); event.exitCode === 0 ? resolve() : reject(new Error(`OpenSSH exit ${event.exitCode}`)); });
        });
        assert.ok(authenticated && passwordSent && codeSent && exitSent);
        assert.ok(!output.includes('fixture*secret'), 'password must not echo');
        assert.ok(!output.includes('719243'), 'verification code must not echo');
        console.info('OpenSSH real PTY password + OTP + exit: PASS');
    } finally {
        terminal?.kill();
        connection?.end();
        await new Promise<void>(resolve => server.close(() => resolve()));
        await rm(trust, { recursive: true, force: true });
    }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });

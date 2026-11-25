import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { Server, type Connection } from 'ssh2';
import WebSocket, { WebSocketServer } from 'ws';
import type { AuthenticatedWebSocket } from '../websocket/types';

const directory = mkdtempSync(join(tmpdir(), 'fantetic-openssh-handler-'));
process.env.APP_BACKEND_DATA_PATH = directory;
process.env.ENCRYPTION_KEY = '12'.repeat(32);
async function run() {
    const { startOpenSshTerminal } = await import('../websocket/handlers/openssh.handler');
    const { handleSshInput, handleSshResize } = await import('../websocket/handlers/ssh.handler');
    const { clientStates } = await import('../websocket/state');
    const { settingsRepository } = await import('../settings/settings.repository');
    const { getDbInstance, withTransaction } = await import('../database/connection');
    const db = await getDbInstance();
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
    let sshConnection: Connection | undefined;
    let receivedPassword = false;
    const ssh = new Server({ hostKeys: [key] }, connection => {
        sshConnection = connection;
        connection.on('error', () => { /* Browser cancellation intentionally closes auth. */ });
        connection.on('ready', () => connection.on('session', accept => {
            const session = accept();
            session.on('pty', allow => allow?.());
            session.on('shell', allow => allow());
        }));
        connection.on('authentication', auth => {
            if (auth.method !== 'keyboard-interactive') { auth.reject(['keyboard-interactive']); return; }
            auth.prompt([{ prompt: 'Handler password: ', echo: false }], answers => {
                assert.deepEqual(answers, ['handler*secret']);
                receivedPassword = true;
                auth.accept();
            });
        });
    });
    await new Promise<void>(resolve => ssh.listen(0, '127.0.0.1', resolve));
    const address = ssh.address();
    assert.ok(address && typeof address === 'object');
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>(resolve => wss.once('listening', resolve));
    const wsAddress = wss.address();
    assert.ok(wsAddress && typeof wsAddress === 'object');
    const accepted = new Promise<AuthenticatedWebSocket>(resolve => wss.once('connection', resolve));
    const browser = new WebSocket(`ws://127.0.0.1:${wsAddress.port}`);
    const ws = await accepted;
    const target = { id: 1, name: 'Fixture', host: '127.0.0.1', port: address.port, username: 'fixture', auth_method: 'password' as const };
    try {
        const denied = new Promise<unknown>(resolve => browser.once('message', value => resolve(JSON.parse(value.toString()))));
        await startOpenSshTerminal(ws, target, 80, 24);
        assert.deepEqual(await denied, { type: 'ssh:error', payload: { code: 'OPENSSH_RECORDING_REQUIRED' } });
        assert.equal(ws.sessionId, undefined);
        await settingsRepository.setSetting('sessionRecordingEnabled', 'false');
        let hostAccepted = false;
        let passwordSent = false;
        let authenticated = false;
        let output = '';
        ws.on('message', raw => {
            const message = JSON.parse(raw.toString());
            if (message.type === 'ssh:input') handleSshInput(ws, message.payload);
            if (message.type === 'ssh:resize') handleSshResize(ws, message.payload);
        });
        browser.on('message', raw => {
            const message = JSON.parse(raw.toString());
            if (message.type === 'ssh:terminal-ready') {
                browser.send(JSON.stringify({ type: 'ssh:resize', payload: { cols: 120, rows: 40 } }));
            }
            if (message.type === 'ssh:authenticated') {
                assert.ok(receivedPassword);
                assert.equal(message.payload.sessionId, ws.sessionId);
                assert.equal(message.payload.connectionId, target.id);
                authenticated = true;
            }
            if (message.type !== 'ssh:output') return;
            output += Buffer.from(message.payload, 'base64').toString();
            const write = (data: string) => browser.send(JSON.stringify({ type: 'ssh:input', payload: { data } }));
            if (!hostAccepted && output.includes('continue connecting')) { hostAccepted = true; write('yes\r'); }
            if (!passwordSent && output.includes('Handler password:')) { passwordSent = true; write('handler*secret\r'); }
        });
        await startOpenSshTerminal(ws, target, 80, 24);
        const deadline = Date.now() + 15000;
        while (!authenticated && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        assert.ok(authenticated, 'OpenSSH must signal successful authentication');
        assert.ok(!output.includes('handler*secret'));
        const sessionId = ws.sessionId;
        assert.ok(sessionId);
        browser.close();
        while (clientStates.has(sessionId) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        assert.ok(!clientStates.has(sessionId), 'browser close must release PTY state');
        console.info('OpenSSH handler recording guard, WebSocket input, cancellation: PASS');
    } finally {
        browser.terminate();
        ws.terminate();
        sshConnection?.end();
        await new Promise<void>(resolve => wss.close(() => resolve()));
        await new Promise<void>(resolve => ssh.close(() => resolve()));
        await withTransaction(db, async () => undefined);
        await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
        rmSync(directory, { recursive: true, force: true });
    }
}
void run().catch(error => { console.error(error); process.exitCode = 1; });

import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOpenSshArguments, openSshExecutable } from '../../services/openssh.service';
import type { DecryptedConnectionDetails } from '../../services/ssh.service';
import type { AuthenticatedWebSocket, ClientState } from '../types';
import { clientStates } from '../state';
import { scheduleSshOutput, flushSshOutput } from '../ssh-output-buffer';
import { requestClientConnectionCleanup } from '../utils';
import { createLogger } from '../../logging/logger';
import { settingsRepository } from '../../settings/settings.repository';

const logger = createLogger('OpenSshHandler');

export async function startOpenSshTerminal(ws: AuthenticatedWebSocket, target: DecryptedConnectionDetails, cols: number, rows: number): Promise<void> {
    const fail = (code: string) => {
        logger.warn('OpenSSH terminal startup rejected', { connectionId: target.id, code });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:error', payload: { code } }));
    };
    if (await settingsRepository.getSetting('sessionRecordingEnabled') !== 'false') {
        fail('OPENSSH_RECORDING_REQUIRED');
        return;
    }
    let args: string[];
    try { args = buildOpenSshArguments(target); }
    catch { fail('OPENSSH_UNSUPPORTED_CONNECTION'); return; }
    const { spawn } = await import('node-pty');
    if (ws.readyState !== WebSocket.OPEN) return;
    const size = (value: number, fallback: number) => Number.isInteger(value) && value > 0 && value <= 1000 ? value : fallback;
    // A real PTY lets OpenSSH own password echo and all authentication rounds.
    // Never pass application credentials or the backend's environment secrets.
    // Isolate host trust between application users; every new session asks for
    // confirmation instead of inheriting the backend account's known_hosts.
    const trustDirectory = await mkdtemp(join(tmpdir(), 'fantetic-openssh-'));
    args.unshift('-o', `UserKnownHostsFile="${join(trustDirectory, 'known_hosts').replace(/\\/g, '/')}"`, '-o', 'GlobalKnownHostsFile=none');
    if (ws.readyState !== WebSocket.OPEN) {
        await rm(trustDirectory, { recursive: true, force: true });
        return;
    }
    // LocalCommand runs after authentication. Its literal command writes only in
    // the private session cwd; neither host nor user input is interpolated.
    args.unshift('-o', 'PermitLocalCommand=yes', '-o', process.platform === 'win32'
        ? 'LocalCommand=cmd.exe /d /c type nul > authenticated'
        : 'LocalCommand=touch authenticated');
    let ready = false;
    const watcher = watch(trustDirectory, (_event, file) => {
        if (file !== 'authenticated' || !ready || ws.readyState !== WebSocket.OPEN) return;
        watcher.close();
        ws.send(JSON.stringify({ type: 'ssh:authenticated', payload: { sessionId: ws.sessionId, connectionId: target.id } }));
    });
    watcher.on('error', () => { watcher.close(); logger.warn('OpenSSH status watcher failed'); });
    let terminal: import('node-pty').IPty;
    try { terminal = spawn(openSshExecutable, args, {
        cwd: trustDirectory, name: 'xterm-256color', cols: size(cols, 80), rows: size(rows, 24),
        // Windows OpenSSH exits with 255 before writing diagnostics without ProgramData.
        env: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'PROGRAMDATA', 'TEMP', 'TMP', 'LANG'].includes(key.toUpperCase()))),
    }); } catch (error) {
        watcher.close();
        await rm(trustDirectory, { recursive: true, force: true });
        logger.warn('OpenSSH process could not start');
        fail('OPENSSH_UNAVAILABLE');
        return;
    }
    const sessionId = randomUUID();
    ws.sessionId = sessionId;
    const state: ClientState = { ws, dbConnectionId: target.id, connectionName: target.name, openSshTerminal: terminal };
    clientStates.set(sessionId, state);
    const close = () => requestClientConnectionCleanup(sessionId);
    ws.once('close', close);
    let receivedOutput = false;
    const startedAt = Date.now();
    terminal.onData(data => {
        if (ws.readyState !== WebSocket.OPEN) { close(); return; }
        if (!receivedOutput) {
            receivedOutput = true;
            logger.info('OpenSSH terminal produced its first output', { connectionId: target.id, elapsedMs: Date.now() - startedAt });
        }
        // Bound memory even when the browser stops reading. Authentication input
        // and output are deliberately excluded from session recordings.
        if (ws.bufferedAmount + (state.pendingSshOutputBytes ?? 0) + Buffer.byteLength(data) > 8 * 1024 * 1024) { ws.close(1013, 'Terminal output overflow'); close(); return; }
        scheduleSshOutput(state, Buffer.from(data));
    });
    terminal.onExit(({ exitCode }) => {
        watcher.close();
        logger.info('OpenSSH process exited', { connectionId: target.id, exitCode, receivedOutput });
        void rm(trustDirectory, { recursive: true, force: true }).catch(() => {
            // A stale directory contains public host keys only, never credentials.
            // Report cleanup failure without exposing host details.
            logger.warn('OpenSSH host trust directory cleanup failed');
        });
        ws.removeListener('close', close);
        flushSshOutput(state, { force: true });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:disconnected', payload: 'OpenSSH exited' }));
        close();
    });
    // This reports terminal availability, not successful server authentication.
    ws.send(JSON.stringify({ type: 'ssh:terminal-ready', payload: { connectionId: target.id, sessionId, engine: 'openssh' } }));
    ready = true;
    logger.info('OpenSSH terminal ready', { connectionId: target.id });
}

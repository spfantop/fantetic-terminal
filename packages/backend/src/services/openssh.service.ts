import type { DecryptedConnectionDetails } from './ssh.service';
import { join } from 'node:path';

export const openSshExecutable = process.platform === 'win32'
    ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe') : '/usr/bin/ssh';

type OpenSshTarget = Pick<DecryptedConnectionDetails, 'host' | 'port' | 'username' | 'auth_method'> & Partial<Pick<DecryptedConnectionDetails, 'proxy' | 'jump_chain' | 'connection_proxy_setting'>>;

export function buildOpenSshArguments(target: OpenSshTarget): string[] {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.:%_-]*$/.test(target.host)
        || !/^[a-zA-Z0-9_][a-zA-Z0-9_.@\\-]*$/.test(target.username)
        || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
        throw new Error('Invalid OpenSSH connection parameters');
    }
    // Saved connections can retain the proxy selector without a configured proxy.
    if (target.auth_method !== 'password' || target.proxy || target.jump_chain?.length || target.connection_proxy_setting === 'jump') {
        throw new Error('OpenSSH terminal supports direct password connections only');
    }
    return ['-F', process.platform === 'win32' ? 'NUL' : '/dev/null', '-tt',
        '-o', 'StrictHostKeyChecking=ask', '-o', 'ClearAllForwardings=yes',
        '-o', 'PermitLocalCommand=no', '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none',
        '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no', '-o', 'IdentityAgent=none',
        '-o', 'PubkeyAuthentication=no', '-o', 'EscapeChar=none',
        // Windows OpenSSH can hold the interactive host-key prompt until this timeout expires.
        ...(process.platform === 'win32' ? [] : ['-o', 'ConnectTimeout=30']),
        '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
        '-p', String(target.port), '-l', target.username, target.host];
}

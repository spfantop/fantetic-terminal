import * as net from 'net';
import * as ConnectionRepository from '../connections/connection.repository';
import * as SshService from './ssh.service';

const TEST_TIMEOUT = 10000;
type TestableConnectionType = 'SSH' | 'TELNET' | 'RDP' | 'VNC';

const testTcpPort = (host: string, port: number, timeout = TEST_TIMEOUT): Promise<{ latency: number }> => {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const socket = net.createConnection({ host, port });
        let settled = false;

        const settle = (callback: () => void) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            callback();
        };

        socket.setTimeout(timeout);
        socket.once('connect', () => {
            const latency = Date.now() - startTime;
            settle(() => resolve({ latency }));
        });
        socket.once('timeout', () => {
            settle(() => reject(new Error('连接测试超时。')));
        });
        socket.once('error', (error) => {
            settle(() => reject(error));
        });
    });
};

export const testConnection = async (connectionId: number): Promise<{ latency: number }> => {
    const connection = await ConnectionRepository.findConnectionByIdWithTags(connectionId);
    if (!connection) {
        throw new Error(`连接 ID ${connectionId} 未找到。`);
    }

    if (connection.type === 'SSH') {
        return SshService.testConnection(connectionId);
    }

    if (connection.type === 'TELNET' || connection.type === 'RDP' || connection.type === 'VNC') {
        return testTcpPort(connection.host, connection.port);
    }

    throw new Error(`连接类型 ${connection.type as string} 暂不支持测试。`);
};

export const testUnsavedConnection = async (connectionConfig: {
    type: TestableConnectionType;
    host: string;
    port: number;
    username?: string;
    auth_method?: 'password' | 'key';
    password?: string;
    private_key?: string;
    passphrase?: string;
    ssh_key_id?: number | null;
    proxy_id?: number | null;
}): Promise<{ latency: number }> => {
    if (connectionConfig.type === 'SSH') {
        return SshService.testUnsavedConnection({
            host: connectionConfig.host,
            port: connectionConfig.port,
            username: connectionConfig.username ?? '',
            auth_method: connectionConfig.auth_method ?? 'password',
            password: connectionConfig.password,
            private_key: connectionConfig.private_key,
            passphrase: connectionConfig.passphrase,
            ssh_key_id: connectionConfig.ssh_key_id,
            proxy_id: connectionConfig.proxy_id,
        });
    }

    return testTcpPort(connectionConfig.host, connectionConfig.port);
};

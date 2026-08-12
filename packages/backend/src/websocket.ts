import http from 'http';
import { WebSocketServer } from 'ws';
import { RequestHandler } from 'express';
import { initializeHeartbeat } from './websocket/heartbeat';
import { initializeUpgradeHandler } from './websocket/upgrade';
import { initializeConnectionHandler } from './websocket/connection';
import { clientStates, sftpService, statusMonitorService } from './websocket/state';
import { sshSuspendService } from './ssh-suspend/ssh-suspend.service';
import { cleanupClientConnection } from './websocket/utils';
import { ClientIpResolver } from './config/client-ip';
import { createWebSocketRuntimeLifecycle } from './websocket/runtime-lifecycle';
import { createLogger } from './logging/logger';

const logger = createLogger('WebSocketRuntime');

export type WebSocketRuntime = WebSocketServer & {
    drainSessions: () => Promise<void>;
};


export {
    ClientState,
    AuthenticatedWebSocket,
    DockerContainer,
    DockerStats,
    PortInfo,
    SshSuspendClientToServerMessages,
    SshSuspendServerToClientMessages,
    SuspendedSessionInfo
} from './websocket/types'; // Re-export essential types

export const initializeWebSocket = async (
    server: http.Server,
    sessionParser: RequestHandler,
    clientIpResolver: ClientIpResolver,
    allowedOrigins: ReadonlySet<string>,
    onActiveConnectionCountChanged?: (count: number) => void,
): Promise<WebSocketRuntime> => {
    // Environment variables are expected to be loaded by index.ts

    const wss = new WebSocketServer({
        noServer: true,
        maxPayload: 4 * 1024 * 1024,
        perMessageDeflate: {
            zlibDeflateOptions: {
                level: 3,
            },
            zlibInflateOptions: {
                chunkSize: 10 * 1024,
            },
            threshold: 64 * 1024,
            serverNoContextTakeover: true,
            clientNoContextTakeover: true,
        },
    });
    // const db = await getDbInstance(); // db instance might not be directly needed here anymore if all DB interactions are in services/handlers

    // 1. Initialize Heartbeat
    const heartbeatTimer = initializeHeartbeat(wss, {
        cleanupClientConnection: sessionId => {
            void cleanupClientConnection(sessionId);
        },
    }); // Store timer to potentially clear it, though heartbeat.ts handles its own wss.on('close')

    // 2. Initialize Upgrade Handler (handles authentication and protocol upgrade)
    initializeUpgradeHandler(server, wss, sessionParser, clientIpResolver, allowedOrigins);

    // 3. Initialize Connection Handler (handles 'connection' event and message routing)
    initializeConnectionHandler(wss, sshSuspendService, sftpService);
    const publishConnectionCount = () => onActiveConnectionCountChanged?.(wss.clients.size);
    wss.on('connection', ws => {
        publishConnectionCount();
        ws.once('close', () => setImmediate(publishConnectionCount));
    });
    publishConnectionCount();

    const lifecycle = createWebSocketRuntimeLifecycle({
        listSessionIds: () => Array.from(clientStates.keys()),
        cleanupSession: cleanupClientConnection,
        stopHeartbeat: () => clearInterval(heartbeatTimer),
        disposeStatusMonitor: () => statusMonitorService.dispose(),
    });
    const runtime = wss as WebSocketRuntime;
    runtime.drainSessions = lifecycle.drain;

    // This is a fallback for callers that close the server directly. Graceful shutdown
    // explicitly awaits drainSessions before the storage phase starts.
    wss.on('close', () => {
        void runtime.drainSessions().catch(error => {
            logger.error('WebSocket server closed before all sessions were cleaned up', { error });
        });
    });


    console.log('WebSocket 服务器初始化完成。');
    return runtime;
};

export { clientStates };

import { PortInfo, ClientState } from './types';
import { clientStates, sftpService, statusMonitorService } from './state';
import { sshSuspendService } from '../ssh-suspend/ssh-suspend.service';
import { clearSshOutputQueue } from './ssh-output-buffer';
import { clearSshInputQueue } from './ssh-input-writer';
import { finishSessionRecording } from '../session-recording/session-recording.service';
import { createKeyedRunOnce } from '../utils/keyed-run-once';
import { resolveSshSessionOwnership } from './ssh-session-ownership';
import { createLogger } from '../logging/logger';
import { runWebSocketSessionCleanup } from './session-cleanup';

const logger = createLogger('WebSocketCleanup');

// --- 解析 Ports 字符串的辅助函数 ---
export function parsePortsString(portsString: string | undefined | null): PortInfo[] {
    if (!portsString) {
        return [];
    }
    const ports: PortInfo[] = [];
    const entries = portsString.split(', ');

    for (const entry of entries) {
        const parts = entry.split('->');
        let publicPart = '';
        let privatePart = '';

        if (parts.length === 2) {
            publicPart = parts[0];
            privatePart = parts[1];
        } else if (parts.length === 1) {
            privatePart = parts[0];
        } else {
            console.warn(`[WebSocket] Skipping unparsable port entry: ${entry}`);
            continue;
        }

        const privateMatch = privatePart.match(/^(\d+)\/(tcp|udp|\w+)$/);
        if (!privateMatch) {
            //  console.warn(`[WebSocket] Skipping unparsable private port part: ${privatePart}`);
             continue;
        }
        const privatePort = parseInt(privateMatch[1], 10);
        const type = privateMatch[2];

        let ip: string | undefined = undefined;
        let publicPort: number | undefined = undefined;

        
        if (publicPart) {
            const publicMatch = publicPart.match(/^(?:([\d.:a-fA-F]+):)?(\d+)$/);
             if (publicMatch) {
                 ip = publicMatch[1] || undefined;
                 publicPort = parseInt(publicMatch[2], 10);
             } else {
                //   console.warn(`[WebSocket] Skipping unparsable public port part: ${publicPart}`);
                   
             }
        }

        if (!isNaN(privatePort)) {
             ports.push({
                 IP: ip,
                 PrivatePort: privatePort,
                 PublicPort: publicPort,
                 Type: type
             });
        }
    }
    return ports;
}


/**
 * 清理指定会话 ID 关联的所有资源
 * @param sessionId - 会话 ID
 */
const cleanupClientConnectionImpl = async (sessionId: string | undefined) => { // Made async
    if (!sessionId) return;

    const state = clientStates.get(sessionId);
    if (state) {
        logger.info('开始清理 WebSocket 会话', { sessionId, userId: state.ws.userId, connectionId: state.dbConnectionId });
        await runWebSocketSessionCleanup({
            clearOutput: () => clearSshOutputQueue(state),
            clearInput: () => clearSshInputQueue(state),
            finishRecording: () => finishSessionRecording(state.sessionRecorder),
            stopStatusPolling: () => statusMonitorService.stopStatusPolling(sessionId),
            cleanupSftp: () => sftpService.cleanupSftpSession(sessionId),
            disconnectTelnet: () => state.telnetService?.disconnect(),
            resolveSshOwnership: async () => {
                const ownershipResult = await resolveSshSessionOwnership({
                    sessionId,
                    userId: state.ws.userId,
                    state,
                    takeOver: details => sshSuspendService.takeOverMarkedSession(details),
                });
                if (ownershipResult === 'transferred') {
                    logger.info('SSH 会话资源已移交给挂起 runtime', { sessionId });
                } else if (ownershipResult === 'closed') {
                    logger.info('SSH 会话资源已关闭', { sessionId });
                } else if (state.isSuspendedByService) {
                    logger.info('SSH 会话资源已由挂起 runtime 管理', { sessionId });
                }
            },
            stopDockerPolling: () => {
                if (state.dockerStatusIntervalId) {
                    clearInterval(state.dockerStatusIntervalId);
                    logger.debug('已停止 WebSocket 会话的 Docker 状态轮询', { sessionId });
                }
            },
            detachState: () => {
                clientStates.delete(sessionId);
                if (state.ws.sessionId === sessionId) delete state.ws.sessionId;
            },
        });
        logger.info('WebSocket 会话清理完成', { sessionId });
    } else {
        // console.warn(`[WebSocket Utils] cleanupClientConnection: No state found for session ID ${sessionId}.`);
    }
};

const cleanupExistingClientConnection = createKeyedRunOnce(cleanupClientConnectionImpl);

export const cleanupClientConnection = (sessionId: string | undefined): Promise<void> => (
    sessionId ? cleanupExistingClientConnection(sessionId) : Promise.resolve()
);

export const requestClientConnectionCleanup = (sessionId: string | undefined): void => {
    void cleanupClientConnection(sessionId).catch(error => {
        logger.error('WebSocket 会话资源清理失败', { sessionId, error });
    });
};

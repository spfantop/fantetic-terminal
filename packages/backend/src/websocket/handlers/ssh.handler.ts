import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedWebSocket, ClientState } from '../types';
import { clientStates, sftpService, statusMonitorService, auditLogService, notificationService } from '../state';
import * as SshService from '../../services/ssh.service';
import { cleanupClientConnection } from '../utils';
import { startDockerStatusPolling } from './docker.handler';
import WebSocket from 'ws';
import { flushSshOutput, scheduleSshOutput } from '../ssh-output-buffer';
import { writeSshInput } from '../ssh-input-writer';
import { appendSuspendLogBatch, createSuspendLogBatcher, flushSuspendLogBatcher } from '../suspend-log-batcher';
import { AccessControlApplication } from '../../access-control/access-control.application';
import { accessControlRepository } from '../../access-control/access-control.repository';
import { startSessionRecording } from '../../session-recording/session-recording.service';
import { createLogger } from '../../logging/logger';

const accessControlApplication = new AccessControlApplication(accessControlRepository);
const logger = createLogger('SshHandler');

export async function handleSshConnect(
    ws: AuthenticatedWebSocket,
    request: Request,
    payload: any
): Promise<void> {
    const sessionId = ws.sessionId;
    const existingState = sessionId ? clientStates.get(sessionId) : undefined;

    if (sessionId && existingState) {
        logger.warn('SSH 连接请求被忽略：已存在活动会话', { userId: ws.userId, sessionId });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:error', payload: '已存在活动的 SSH 连接。' }));
        return;
    }

    const dbConnectionId = payload?.connectionId;
    if (!dbConnectionId) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:error', payload: '缺少 connectionId。' }));
        return;
    }

    if (!ws.authorization) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:error', payload: 'ACCESS_DENIED' }));
        return;
    }
    try {
        await accessControlApplication.requireConnectionPermission(
            ws.authorization,
            Number(dbConnectionId),
            'connect',
        );
    } catch {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:error', payload: 'ACCESS_DENIED' }));
        return;
    }

    logger.info('收到 SSH 连接请求', { userId: ws.userId, connectionId: dbConnectionId });
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:status', payload: '正在处理连接请求...' }));

    const clientIp = (request as any).clientIpAddress || 'unknown';
    let connInfo: SshService.DecryptedConnectionDetails | null = null;

    try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:status', payload: '正在获取连接信息...' }));
        connInfo = await SshService.getConnectionDetails(dbConnectionId);

        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:status', payload: `正在连接到 ${connInfo.host}...` }));
        const sshClient = await SshService.establishSshConnection(connInfo);

        const newSessionId = uuidv4();
        ws.sessionId = newSessionId; // Assign new sessionId to the WebSocket

        const dbConnectionIdAsNumber = parseInt(dbConnectionId, 10);
        if (isNaN(dbConnectionIdAsNumber)) {
            logger.error('无法创建 SSH 会话：连接 ID 无效', { userId: ws.userId, sessionId: newSessionId });
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:error', payload: '无效的连接 ID。' }));
            sshClient.end();
            ws.close(1008, 'Invalid Connection ID');
            return;
        }

        const newState: ClientState = {
            ws: ws,
            sshClient: sshClient,
            dbConnectionId: dbConnectionIdAsNumber,
            connectionName: connInfo!.name,
            ipAddress: clientIp,
            isShellReady: false,
            supportsSshBinaryOutput: payload?.clientCapabilities?.sshBinaryOutput === true,
            supportsSshBinaryInput: payload?.clientCapabilities?.sshBinaryInput === true,
        };
        clientStates.set(newSessionId, newState);
        try {
            newState.sessionRecorder = await startSessionRecording({
                userId: ws.userId,
                username: ws.username,
                connectionId: dbConnectionIdAsNumber,
                connectionName: connInfo!.name,
                protocol: 'SSH',
            });
        } catch (error) {
            logger.error('SSH 会话启动录像失败', { sessionId: newSessionId, connectionId: dbConnectionIdAsNumber, error });
            await auditLogService.logAction('SESSION_RECORDING_FAILURE', {
                userId: ws.userId,
                username: ws.username,
                connectionId: dbConnectionIdAsNumber,
                sessionId: newSessionId,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
        logger.info('已创建 SSH 会话', { userId: ws.userId, sessionId: newSessionId, connectionId: dbConnectionIdAsNumber });

        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:status', payload: 'SSH 连接成功，正在打开 Shell...' }));
        try {
            const defaultCols = payload?.cols || 80; // Use provided cols or default
            const defaultRows = payload?.rows || 24; // Use provided rows or default
            sshClient.shell({ term: payload?.term || 'xterm-256color', cols: defaultCols, rows: defaultRows }, (err, stream) => {
                if (err) {
                    logger.error('SSH 会话打开 Shell 失败', { sessionId: newSessionId, connectionId: dbConnectionIdAsNumber, error: err });
                    auditLogService.logAction('SSH_SHELL_FAILURE', {
                        connectionName: newState.connectionName,
                        userId: ws.userId,
                        username: ws.username,
                        connectionId: dbConnectionIdAsNumber,
                        sessionId: newSessionId,
                        ip: newState.ipAddress,
                        reason: err.message
                    });
                    notificationService.sendNotification('SSH_SHELL_FAILURE', {
                        userId: ws.userId,
                        username: ws.username,
                        connectionId: dbConnectionIdAsNumber,
                        sessionId: newSessionId,
                        ip: newState.ipAddress,
                        reason: err.message
                    });
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ssh:error', payload: `打开 Shell 失败: ${err.message}` }));
                    }
                    cleanupClientConnection(newSessionId);
                    return;
                }

                logger.info('SSH 会话 Shell 已打开', { sessionId: newSessionId, cols: defaultCols, rows: defaultRows });
                newState.sshShellStream = stream;
                newState.isShellReady = true;

                stream.on('data', (data: Buffer) => {
                    newState.sessionRecorder?.recordOutput(data);
                    scheduleSshOutput(newState, data);
                    // 如果会话被标记为待挂起，则将输出写入日志
                    const currentState = clientStates.get(newSessionId); // 获取最新的状态
                    if (currentState?.isMarkedForSuspend && currentState.suspendLogPath) {
                        createSuspendLogBatcher(currentState.suspendLogPath);
                        appendSuspendLogBatch(currentState.suspendLogPath, data.toString('utf-8'));
                    }
                });
                stream.stderr.on('data', (data: Buffer) => {
                    if (process.env.DEBUG_SSH_STDERR === 'true') logger.debug('收到 SSH 标准错误输出', { sessionId: newSessionId, byteLength: data.byteLength });
                    newState.sessionRecorder?.recordOutput(data);
                    scheduleSshOutput(newState, data);
                    // 同样，如果会话被标记为待挂起，则将 stderr 输出写入日志
                    const currentState = clientStates.get(newSessionId);
                    if (currentState?.isMarkedForSuspend && currentState.suspendLogPath) {
                        createSuspendLogBatcher(currentState.suspendLogPath);
                        appendSuspendLogBatch(currentState.suspendLogPath, `[STDERR] ${data.toString('utf-8')}`);
                    }
                });
                stream.on('close', () => {
                    flushSshOutput(newState, { force: true });
                    if (newState.suspendLogPath) {
                        flushSuspendLogBatcher(newState.suspendLogPath).catch(err => {
                            logger.error('刷新挂起 SSH 会话记录失败', { sessionId: newSessionId, error: err });
                        });
                    }
                    logger.info('SSH 会话 Shell 通道已关闭', { sessionId: newSessionId });
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ssh:disconnected', payload: 'Shell 通道已关闭。' }));
                    }
                    cleanupClientConnection(newSessionId);
                });

                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({
                    type: 'ssh:connected',
                    payload: {
                        connectionId: dbConnectionIdAsNumber,
                        sessionId: newSessionId,
                        serverCapabilities: { sshBinaryInput: true, sshBinaryOutput: newState.supportsSshBinaryOutput === true }
                    }
                }));
                logger.info('SSH 连接和 Shell 已建立', { sessionId: newSessionId, connectionId: dbConnectionIdAsNumber });
                auditLogService.logAction('SSH_CONNECT_SUCCESS', {
                    userId: ws.userId,
                    username: ws.username,
                    connectionId: dbConnectionIdAsNumber,
                    sessionId: newSessionId,
                    ip: newState.ipAddress,
                    connectionName: connInfo!.name,
                });
                notificationService.sendNotification('SSH_CONNECT_SUCCESS', {
                    userId: ws.userId,
                    username: ws.username,
                    connectionId: dbConnectionIdAsNumber,
                    sessionId: newSessionId,
                    ip: newState.ipAddress
                });

                sftpService.initializeSftpSession(newSessionId)
                    .then(() => logger.info('SSH 会话的 SFTP 初始化成功', { sessionId: newSessionId }))
                    .catch(sftpInitError => logger.error('SSH 会话的 SFTP 初始化失败', { sessionId: newSessionId, error: sftpInitError }));

                statusMonitorService.startStatusPolling(newSessionId);
                startDockerStatusPolling(newSessionId); // Start Docker polling
            });
        } catch (shellError: any) {
            logger.error('SSH 会话打开 Shell 时发生异常', { sessionId: newSessionId, error: shellError });
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ssh:error', payload: `打开 Shell 时发生意外错误: ${shellError.message}` }));
            }
            cleanupClientConnection(newSessionId);
        }

        sshClient.on('close', () => {
            flushSshOutput(newState, { force: true });
            if (newState.suspendLogPath) {
                flushSuspendLogBatcher(newState.suspendLogPath).catch(err => {
                    logger.error('刷新挂起 SSH 会话记录失败', { sessionId: newSessionId, error: err });
                });
            }
            logger.info('SSH 客户端连接已关闭', { sessionId: newSessionId });
            cleanupClientConnection(newSessionId);
        });
        sshClient.on('error', (err: Error) => {
            flushSshOutput(newState, { force: true });
            if (newState.suspendLogPath) {
                flushSuspendLogBatcher(newState.suspendLogPath).catch(flushError => {
                    logger.error('刷新挂起 SSH 会话记录失败', { sessionId: newSessionId, error: flushError });
                });
            }
            logger.error('SSH 客户端连接发生错误', { sessionId: newSessionId, error: err });
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ssh:error', payload: `SSH 连接错误: ${err.message}` }));
            }
            cleanupClientConnection(newSessionId);
        });

    } catch (connectError: any) {
        logger.error('SSH 连接失败', { userId: ws.userId, connectionId: dbConnectionId, error: connectError });
        auditLogService.logAction('SSH_CONNECT_FAILURE', {
            userId: ws.userId,
            username: ws.username,
            connectionId: dbConnectionId,
            connectionName: connInfo?.name || 'Unknown',
            ip: clientIp,
            reason: connectError.message
        });
        notificationService.sendNotification('SSH_CONNECT_FAILURE', {
            userId: ws.userId,
            username: ws.username,
            connectionId: dbConnectionId,
            ip: clientIp,
            reason: connectError.message
        });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:error', payload: `连接失败: ${connectError.message}` }));
        ws.close(1011, `SSH Connection Failed: ${connectError.message}`);
    }
}

export function handleSshInput(ws: AuthenticatedWebSocket, payload: any): void {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;

    if (!state || !state.sshShellStream) {
        logger.warn('收到 SSH 输入但无活动 Shell', { userId: ws.userId, sessionId });
        return;
    }
    const data = payload?.data;
    if (typeof data === 'string' && state.isShellReady) {
        writeSshInput(state, data);
    } else if (!state.isShellReady) {
        logger.warn('收到 SSH 输入但 Shell 尚未就绪', { userId: ws.userId, sessionId });
    }
}

export function handleSshResize(ws: AuthenticatedWebSocket, payload: any): void {
    const sessionId = ws.sessionId;
    const state = sessionId ? clientStates.get(sessionId) : undefined;

    if (!state || !state.sshClient) { // sshClient is enough, stream might not be ready for resize yet
        logger.warn('收到终端调整大小请求但无有效 SSH 会话', { userId: ws.userId, sessionId });
        return;
    }

    const { cols, rows } = payload || {};
    if (typeof cols !== 'number' || typeof rows !== 'number' || cols <= 0 || rows <= 0) {
        logger.warn('收到无效的终端调整大小请求', { userId: ws.userId, sessionId });
        return;
    }

    if (state.isShellReady && state.sshShellStream) {
        if (process.env.DEBUG_TERMINAL_RESIZE === 'true') {
            logger.debug('调整 SSH 终端大小', { sessionId, cols, rows });
        }
        state.sshShellStream.setWindow(rows, cols, 0, 0);
        state.sessionRecorder?.recordResize(cols, rows);
    } else {
        // Store intended size if shell not ready, apply when shell is ready.
        // This part is a bit more complex as it requires modifying the shell opening logic.
        // For now, we just log if shell is not ready.
        logger.warn('SSH 会话 Shell 未就绪，未立即应用终端尺寸', { sessionId, shellReady: state.isShellReady });
        // A more robust solution would queue the resize or store it in ClientState to be applied later.
    }
}

// 处理会话恢复后的状态监控启动
export function handleSshResumeSuccess(sessionId: string): void {
    const state = clientStates.get(sessionId);
    if (state && state.sshClient) {
        statusMonitorService.startStatusPolling(sessionId);
        // 如果 Docker 状态也需要恢复，可以在这里添加
        // startDockerStatusPolling(sessionId);
    } else {
        logger.error('无法为恢复的 SSH 会话启动状态轮询', { sessionId });
    }
}

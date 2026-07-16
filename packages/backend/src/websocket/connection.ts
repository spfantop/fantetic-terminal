import WebSocket, { WebSocketServer, RawData } from 'ws';
import { Request } from 'express';
import {
    AuthenticatedWebSocket,
    SshSuspendStartRequest,
    SshSuspendListRequest,
    SshSuspendResumeRequest,
    SshSuspendTerminateRequest,
    SshSuspendRemoveEntryRequest,
    // SshSuspendEditNameRequest, // Removed as it's now HTTP
    SshSuspendStartedResponse,
    SshSuspendListResponse,
    SshSuspendResumedNotification,
    SshOutputCachedChunk,
    SshSuspendTerminatedResponse,
    SshSuspendEntryRemovedResponse,
    // SshSuspendNameEditedResponse, // Removed as it's now HTTP
    SshSuspendAutoTerminatedNotification,
    SshMarkForSuspendRequest,
    SshMarkedForSuspendAck,
    SshUnmarkForSuspendRequest,
    SshUnmarkedForSuspendAck,
    ClientState
} from './types';
import { SshSuspendService } from '../ssh-suspend/ssh-suspend.service';
import { SftpService } from '../sftp/sftp.service';
import { cleanupClientConnection } from './utils';
import { flushSshOutput, scheduleSshOutput } from './ssh-output-buffer';
import { clientStates } from './state';
import { temporaryLogStorageService } from '../ssh-suspend/temporary-log-storage.service';
import { buildSshInputDataPrefix, parseSshInputFastPath } from './ssh-input-fast-path';
import { writeSshInput } from './ssh-input-writer';
import { readOwnedClientState } from './session-access';
import { BoundedTaskQueue } from './bounded-task-queue';
import { installWebSocketErrorSanitizer } from './error-sanitizer';
import { createLogger } from '../logging/logger';

const logger = createLogger('WebSocketConnection');

const SSH_INPUT_BINARY_HEADER = Buffer.from([0x53, 0x53, 0x48, 0x49]); // SSHI
const SSH_INPUT_BINARY_HEADER_LENGTH = SSH_INPUT_BINARY_HEADER.length;
const ASCII_INPUT_BUFFER_CACHE = Array.from({ length: 128 }, (_, code) => Buffer.from([code]));

const hasSshInputBinaryHeader = (message: Buffer): boolean => (
    message.length > SSH_INPUT_BINARY_HEADER_LENGTH
    && message[0] === SSH_INPUT_BINARY_HEADER[0]
    && message[1] === SSH_INPUT_BINARY_HEADER[1]
    && message[2] === SSH_INPUT_BINARY_HEADER[2]
    && message[3] === SSH_INPUT_BINARY_HEADER[3]
);

const readSshInputBinaryPayload = (message: RawData): Buffer | null => {
    if (!Buffer.isBuffer(message) || !hasSshInputBinaryHeader(message)) return null;
    if (message.length === SSH_INPUT_BINARY_HEADER_LENGTH + 1) {
        const code = message[SSH_INPUT_BINARY_HEADER_LENGTH];
        if (code < ASCII_INPUT_BUFFER_CACHE.length) return ASCII_INPUT_BUFFER_CACHE[code];
    }
    return message.subarray(SSH_INPUT_BINARY_HEADER_LENGTH);
};

// Handlers
import { handleRdpProxyConnection } from './handlers/rdp.handler';
import {
    handleSshConnect,
    handleSshInput,
    handleSshResize,
    handleSshResumeSuccess
} from './handlers/ssh.handler';
import {
    handleDockerGetStatus,
    handleDockerCommand,
    handleDockerGetStats
} from './handlers/docker.handler';
import {
    handleProcessList,
    handleProcessSignal
} from './handlers/process.handler';
import {
    handleSftpOperation,
    handleSftpUploadStart,
    handleSftpUploadChunk,
    handleSftpUploadCancel
} from './handlers/sftp.handler';
import {
    handleTelnetConnect,
    handleTelnetInput,
    handleTelnetResize,
    handleTelnetDisconnect
} from '../telnet/telnet.handler';

export function initializeConnectionHandler(wss: WebSocketServer, sshSuspendService: SshSuspendService, sftpService: SftpService): void { // +++ Add sftpService parameter +++
    wss.on('connection', (ws: AuthenticatedWebSocket, request: Request) => {
        installWebSocketErrorSanitizer(ws);
        ws.isAlive = true;
        const isRdpProxy = (request as any).isRdpProxy;
        const clientIp = (request as any).clientIpAddress || 'unknown'; // Preserved from upgrade handler

        logger.info('WebSocket 客户端已连接', { userId: ws.userId, sourceIp: clientIp, remoteDesktopProxy: isRdpProxy === true });

        ws.on('pong', () => { ws.isAlive = true; });

        if (isRdpProxy) {
            void handleRdpProxyConnection(ws, request).catch(error => {
                logger.error('远程桌面 WebSocket 代理初始化失败', { userId: ws.userId, error });
                if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Remote desktop proxy initialization failed');
            });
        } else {
            // Standard SSH/SFTP/Docker connection
            let cachedFastSshInputBoundSessionId = '';
            let cachedFastSshInputPrefix: string | null = null;
            let cachedFastSshInputFallbackPrefix: string | null = null;
            const controlMessageQueue = new BoundedTaskQueue({ maxTasks: 128, maxBytes: 8 * 1024 * 1024 });
            ws.on('message', (message: RawData) => {
                const sshInputBinaryPayload = readSshInputBinaryPayload(message);
                if (sshInputBinaryPayload) {
                    if (ws.sessionId) {
                        const state = clientStates.get(ws.sessionId);
                        if (state?.sshShellStream && state.isShellReady) {
                            writeSshInput(state, sshInputBinaryPayload);
                        } else if (!state?.sshShellStream) {
                            logger.warn('收到 SSH 二进制输入但无活动 Shell', { sessionId: ws.sessionId });
                        } else {
                            logger.warn('收到 SSH 二进制输入但 Shell 尚未就绪', { sessionId: ws.sessionId });
                        }
                    }
                    return;
                }

                const messageText = message.toString();
                if (ws.sessionId && ws.sessionId !== cachedFastSshInputBoundSessionId) {
                    cachedFastSshInputBoundSessionId = ws.sessionId;
                    cachedFastSshInputPrefix = buildSshInputDataPrefix(ws.sessionId);
                }
                let fastSshInput = cachedFastSshInputPrefix ? parseSshInputFastPath(messageText, cachedFastSshInputPrefix) : null;
                if (fastSshInput === null && cachedFastSshInputFallbackPrefix) {
                    fastSshInput = parseSshInputFastPath(messageText, cachedFastSshInputFallbackPrefix);
                }
                if (fastSshInput === null) {
                    const parsedFastSshInput = parseSshInputFastPath(messageText);
                    if (parsedFastSshInput) {
                        fastSshInput = parsedFastSshInput.data;
                        cachedFastSshInputFallbackPrefix = buildSshInputDataPrefix(parsedFastSshInput.sessionId);
                    }
                }
                if (fastSshInput !== null && ws.sessionId) {
                    const state = clientStates.get(ws.sessionId);
                    if (state?.sshShellStream && state.isShellReady) {
                        writeSshInput(state, fastSshInput);
                    } else if (!state?.sshShellStream) {
                        logger.warn('收到 SSH 输入但无活动 Shell', { sessionId: ws.sessionId });
                    } else {
                        logger.warn('收到 SSH 输入但 Shell 尚未就绪', { sessionId: ws.sessionId });
                    }
                    return;
                }

                let parsedMessage: any;
                try {
                    parsedMessage = JSON.parse(messageText);
                } catch (e) {
                    logger.warn('收到无效的 WebSocket JSON 消息', { userId: ws.userId });
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', payload: '无效的消息格式 (非 JSON)' }));
                    return;
                }

                const { type, payload, requestId } = parsedMessage;
                const sessionId = ws.sessionId; // Get current WebSocket's session ID

                // It's crucial to get the state associated with the current ws.sessionId
                // For 'ssh:connect', ws.sessionId will be undefined initially, so state will be undefined.
                // For other messages, ws.sessionId should exist if connection was successful.
                const state = sessionId ? clientStates.get(sessionId) : undefined;

                const accepted = controlMessageQueue.enqueue(Buffer.byteLength(messageText), async () => {
                    try {
                        switch (type) {
                            case 'client:ping':
                                if (ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({
                                        type: 'client:pong',
                                        payload: {
                                            ...(payload && typeof payload === 'object' ? payload : {}),
                                            serverAt: Date.now(),
                                        },
                                    }));
                                }
                                break;

                            // SSH Cases
                            case 'ssh:connect':
                                // Pass the original Express request object for IP and session
                                await handleSshConnect(ws, request, payload);
                                break;
                            case 'ssh:input':
                                handleSshInput(ws, payload);
                                break;
                            case 'ssh:resize':
                                handleSshResize(ws, payload);
                                break;

                            case 'telnet:connect':
                                await handleTelnetConnect(ws, payload, request as any);
                                break;
                            case 'telnet:input':
                                handleTelnetInput(ws, payload);
                                break;
                            case 'telnet:resize':
                                handleTelnetResize(ws, payload);
                                break;
                            case 'telnet:disconnect':
                                handleTelnetDisconnect(ws, payload);
                                break;

                            // Docker Cases
                            case 'docker:get_status':
                                await handleDockerGetStatus(ws, sessionId);
                                break;
                            case 'docker:command':
                                await handleDockerCommand(ws, sessionId, payload);
                                break;
                            case 'docker:get_stats':
                                await handleDockerGetStats(ws, sessionId, payload);
                                break;
                            case 'process:list':
                                await handleProcessList(ws, sessionId, payload);
                                break;
                            case 'process:signal':
                                await handleProcessSignal(ws, sessionId, payload);
                                break;

                            // SFTP Cases (generic operations)
                            case 'sftp:readdir':
                            case 'sftp:stat':
                            case 'sftp:readfile':
                            case 'sftp:writefile':
                            case 'sftp:mkdir':
                            case 'sftp:rmdir':
                            case 'sftp:unlink':
                            case 'sftp:rename':
                            case 'sftp:chmod':
                            case 'sftp:realpath':
                            case 'sftp:copy':
                            case 'sftp:move':
                            case 'sftp:compress':
                            case 'sftp:decompress':
                                await handleSftpOperation(ws, type, payload, requestId);
                                break;

                            // SFTP Upload Cases
                            case 'sftp:upload:start':
                                handleSftpUploadStart(ws, payload);
                                break;
                            case 'sftp:upload:chunk':
                                await handleSftpUploadChunk(ws, payload);
                                break;
                            case 'sftp:upload:cancel':
                                handleSftpUploadCancel(ws, payload);
                                break;

                            // --- SSH Suspend Cases ---

                            case 'SSH_SUSPEND_LIST_REQUEST': {
                                if (!ws.userId) {
                                    logger.error('列出挂起会话时缺少用户身份');
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_LIST_RESPONSE', payload: { suspendSessions: [] } })); // 返回空列表或错误
                                    break;
                                }
                                try {
                                    const sessions = await sshSuspendService.listSuspendedSessions(ws.userId);
                                    const response: SshSuspendListResponse = {
                                        type: 'SSH_SUSPEND_LIST_RESPONSE',
                                        payload: { suspendSessions: sessions }
                                    };
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                                } catch (error: any) {
                                    logger.error('获取挂起会话列表失败', { userId: ws.userId, error });
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_LIST_RESPONSE', payload: { suspendSessions: [] } })); // 返回空列表或错误
                                }
                                break;
                            }
                            case 'SSH_SUSPEND_RESUME_REQUEST': {
                                const resumePayload = payload as SshSuspendResumeRequest['payload'];
                                const { suspendSessionId, newFrontendSessionId } = resumePayload;
                                if (!ws.userId) {
                                    logger.error('恢复挂起会话时缺少用户身份', { suspendSessionId });
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_RESUMED_NOTIF', payload: { suspendSessionId, newFrontendSessionId, success: false, error: '用户认证失败' } }));
                                    break;
                                }
                                try {
                                    const result = await sshSuspendService.resumeSession(ws.userId, suspendSessionId);

                                    if (result) {
                                        const newSessionState: ClientState = {
                                            ws, // 当前的 WebSocket 连接
                                            sshClient: result.sshClient,
                                            sshShellStream: result.channel,
                                            dbConnectionId: parseInt(result.originalConnectionId, 10), // 从结果中恢复并转换为数字
                                            connectionName: result.connectionName, // 从结果中恢复
                                            ipAddress: clientIp,
                                            isShellReady: true, // 假设恢复后 Shell 立即可用
                                            supportsSshBinaryOutput: resumePayload.clientCapabilities?.sshBinaryOutput === true,
                                            supportsSshBinaryInput: resumePayload.clientCapabilities?.sshBinaryInput === true,
                                        };
                                        clientStates.set(newFrontendSessionId, newSessionState);
                                        ws.sessionId = newFrontendSessionId; // 将当前 ws 与新会话关联
                                        sftpService.initializeSftpSession(newFrontendSessionId)
                                            .then(() => undefined)
                                            .catch(sftpInitErr => {
                                                logger.error('恢复会话后初始化 SFTP 失败', { sessionId: newFrontendSessionId, error: sftpInitErr });
                                            });

                                        // 重新设置事件监听器，将数据流导向新的前端会话
                                        result.channel.removeAllListeners('data'); // 清除 SshSuspendService 可能设置的监听器
                                        result.channel.on('data', (data: Buffer) => {
                                            scheduleSshOutput(newSessionState, data);
                                        });
                                        result.channel.on('close', () => {
                                            flushSshOutput(newSessionState, { force: true });
                                            logger.info('恢复的 SSH 会话通道已关闭', { sessionId: newFrontendSessionId });
                                            if (ws.readyState === WebSocket.OPEN) {
                                                ws.send(JSON.stringify({ type: 'ssh:disconnected', payload: { sessionId: newFrontendSessionId } }));
                                            }
                                            cleanupClientConnection(newFrontendSessionId);
                                        });
                                         result.sshClient.on('error', (err: Error) => {
                                            flushSshOutput(newSessionState, { force: true });
                                            logger.error('恢复后的 SSH 客户端发生错误', { sessionId: newFrontendSessionId, error: err });
                                            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:error', payload: { sessionId: newFrontendSessionId, error: err.message } }));
                                            cleanupClientConnection(newFrontendSessionId);
                                        });
                                        if (process.env.DEBUG_SSH_SUSPEND === 'true') {
                                            logger.debug('准备发送恢复会话缓存输出', { sessionId: newFrontendSessionId, byteLength: Buffer.byteLength(result.logData) });
                                        }
                                        const logChunkResponse: SshOutputCachedChunk = {
                                            type: 'SSH_OUTPUT_CACHED_CHUNK',
                                            payload: { frontendSessionId: newFrontendSessionId, data: result.logData, isLastChunk: true }
                                        };
                                        if (ws.readyState === WebSocket.OPEN) {
                                            ws.send(JSON.stringify(logChunkResponse));
                                        }

                                        // +++ 发送 ssh:connected 消息 +++
                                        if (ws.readyState === WebSocket.OPEN) {
                                            ws.send(JSON.stringify({
                                                type: 'ssh:connected',
                                                payload: {
                                                    connectionId: newSessionState.dbConnectionId, // 使用已恢复的 dbConnectionId
                                                    sessionId: newFrontendSessionId, // 使用新的前端会话 ID
                                                    serverCapabilities: { sshBinaryInput: true, sshBinaryOutput: newSessionState.supportsSshBinaryOutput === true }
                                                }
                                            }));
                                            logger.info('已通知客户端恢复的 SSH 会话已连接', { sessionId: newFrontendSessionId });
                                        }


                                        const responseNotification: SshSuspendResumedNotification = { // 确保变量名不冲突且类型正确
                                            type: 'SSH_SUSPEND_RESUMED_NOTIF', // 改回与前端和新类型定义一致
                                            payload: { suspendSessionId, newFrontendSessionId, success: true }
                                        };
                                        if (ws.readyState === WebSocket.OPEN) {
                                            ws.send(JSON.stringify(responseNotification));
                                        }

                                        // 在成功恢复并通知前端后，调用 handleSshResumeSuccess 启动状态监控
                                        handleSshResumeSuccess(newFrontendSessionId);

                                    } else {
                                        throw new Error('服务未能恢复会话，或会话不存在/状态不正确。');
                                    }
                                } catch (error: any) {
                                    logger.error('恢复挂起会话失败', { userId: ws.userId, suspendSessionId, error });
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_RESUMED_NOTIF', payload: { suspendSessionId, newFrontendSessionId, success: false, error: error.message || '恢复会话失败' } }));
                                }
                                break;
                            }
                            case 'SSH_SUSPEND_TERMINATE_REQUEST': {
                                const { suspendSessionId } = payload as SshSuspendTerminateRequest['payload'];
                                logger.info('收到终止挂起会话请求', { userId: ws.userId, sessionId: ws.sessionId, suspendSessionId });
                                 if (!ws.userId) {
                                     logger.error('终止挂起会话时缺少用户身份', { suspendSessionId });
                                     if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_TERMINATED_RESP', payload: { suspendSessionId, success: false, error: '用户认证失败' } }));
                                     break;
                                }
                                try {
                                    const success = await sshSuspendService.terminateSuspendedSession(ws.userId, suspendSessionId);
                                    const response: SshSuspendTerminatedResponse = {
                                        type: 'SSH_SUSPEND_TERMINATED',
                                        payload: { suspendSessionId, success }
                                    };
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                                } catch (error: any) {
                                    logger.error('终止挂起会话失败', { userId: ws.userId, suspendSessionId, error });
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_TERMINATED_RESP', payload: { suspendSessionId, success: false, error: error.message || '终止会话失败' } }));
                                }
                                break;
                            }
                            case 'SSH_SUSPEND_REMOVE_ENTRY': {
                                const { suspendSessionId } = payload as SshSuspendRemoveEntryRequest['payload'];
                                logger.info('收到移除挂起会话条目请求', { userId: ws.userId, sessionId: ws.sessionId, suspendSessionId });
                                if (!ws.userId) {
                                    logger.error('移除挂起会话条目时缺少用户身份', { suspendSessionId });
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_ENTRY_REMOVED_RESP', payload: { suspendSessionId, success: false, error: '用户认证失败' } }));
                                    break;
                                }
                                try {
                                    const success = await sshSuspendService.removeDisconnectedSessionEntry(ws.userId, suspendSessionId);
                                    const response: SshSuspendEntryRemovedResponse = {
                                        type: 'SSH_SUSPEND_ENTRY_REMOVED',
                                        payload: { suspendSessionId, success }
                                    };
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                                } catch (error: any) {
                                    logger.error('移除挂起会话条目失败', { userId: ws.userId, suspendSessionId, error });
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_ENTRY_REMOVED_RESP', payload: { suspendSessionId, success: false, error: error.message || '移除条目失败' } }));
                                }
                                break;
                            }
                            // SSH_SUSPEND_EDIT_NAME case removed, handled by HTTP API now
                            case 'SSH_MARK_FOR_SUSPEND': {
                                const markPayload = payload as SshMarkForSuspendRequest['payload'];
                                const sessionToMarkId = markPayload.sessionId;
                                const initialBuffer = markPayload.initialBuffer; // +++ 获取 initialBuffer +++
                                logger.info('收到标记挂起会话请求', { userId: ws.userId, sessionId: sessionToMarkId, hasInitialBuffer: Boolean(initialBuffer) });

                                if (!ws.userId) {
                                    logger.error('标记挂起会话时缺少用户身份', { sessionId: sessionToMarkId });
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_MARKED_FOR_SUSPEND_ACK', payload: { sessionId: sessionToMarkId, success: false, error: '用户认证失败' } as SshMarkedForSuspendAck['payload'] }));
                                    break;
                                }

                                const activeSessionState = readOwnedClientState(clientStates, ws, sessionToMarkId);
                                if (!activeSessionState || !activeSessionState.sshClient || !activeSessionState.sshShellStream) {
                                    logger.warn('未找到可标记的活动 SSH 会话', { userId: ws.userId, sessionId: sessionToMarkId });
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_MARKED_FOR_SUSPEND_ACK', payload: { sessionId: sessionToMarkId, success: false, error: '未找到要标记的活动SSH会话' } as SshMarkedForSuspendAck['payload'] }));
                                    break;
                                }

                                if (activeSessionState.isMarkedForSuspend) {
                                    logger.warn('SSH 会话已被标记为待挂起', { userId: ws.userId, sessionId: sessionToMarkId });
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_MARKED_FOR_SUSPEND_ACK', payload: { sessionId: sessionToMarkId, success: true, error: '会话已被标记' } as SshMarkedForSuspendAck['payload'] }));
                                    break;
                                }

                                try {
                                    // 使用活动会话ID作为日志文件名的一部分
                                    const logPathSuffix = sessionToMarkId; // 使用原始 sessionId 作为日志文件名
                                    activeSessionState.isMarkedForSuspend = true;
                                    activeSessionState.suspendLogPath = logPathSuffix; // 存储日志标识符 (服务内部会拼接完整路径)

                                    // 确保日志目录存在 (服务内部通常会做，但这里也可以调用一次)
                                    await temporaryLogStorageService.ensureLogDirectoryExists();

                                    // +++ 如果有 initialBuffer，先写入它 +++
                                    if (initialBuffer) {
                                        // 确保 initialBuffer 后有一个换行符，以便后续日志在新行开始
                                        const formattedInitialBuffer = initialBuffer.endsWith('\n') ? initialBuffer : `${initialBuffer}\n`;
                                        await temporaryLogStorageService.writeToLog(logPathSuffix, formattedInitialBuffer);
                                        logger.info('已写入挂起会话初始缓冲区', { sessionId: sessionToMarkId, byteLength: Buffer.byteLength(formattedInitialBuffer) });
                                    }
                                    // --- 移除自动添加的日志标记行 ---
                                    // await temporaryLogStorageService.writeToLog(logPathSuffix, `--- Log recording continued for session ${sessionToMarkId} at ${new Date().toISOString()} ---\n`);

                                    logger.info('SSH 会话已标记为待挂起', { userId: ws.userId, sessionId: sessionToMarkId });
                                    const response: SshMarkedForSuspendAck = {
                                        type: 'SSH_MARKED_FOR_SUSPEND_ACK',
                                        payload: { sessionId: sessionToMarkId, success: true }
                                    };
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                                } catch (error: any) {
                                    logger.error('标记 SSH 会话待挂起失败', { userId: ws.userId, sessionId: sessionToMarkId, error });
                                    if (activeSessionState) { // 如果状态存在，尝试回滚标记
                                        activeSessionState.isMarkedForSuspend = false;
                                        activeSessionState.suspendLogPath = undefined;
                                    }
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_MARKED_FOR_SUSPEND_ACK', payload: { sessionId: sessionToMarkId, success: false, error: error.message || '标记会话失败' } as SshMarkedForSuspendAck['payload'] }));
                                }
                                break;
                            }
                            case 'SSH_UNMARK_FOR_SUSPEND': {
                                const unmarkPayload = payload as SshUnmarkForSuspendRequest['payload'];
                                const sessionToUnmarkId = unmarkPayload.sessionId;
                                logger.info('收到取消标记挂起会话请求', { userId: ws.userId, sessionId: sessionToUnmarkId });
                                const ackPayloadBase = { sessionId: sessionToUnmarkId };

                                if (!ws.userId) {
                                    logger.error('取消标记挂起会话时缺少用户身份', { sessionId: sessionToUnmarkId });
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_UNMARKED_FOR_SUSPEND_ACK', payload: { ...ackPayloadBase, success: false, error: '用户认证失败' } as SshUnmarkedForSuspendAck['payload'] }));
                                    break;
                                }

                                const activeSessionState = readOwnedClientState(clientStates, ws, sessionToUnmarkId);
                                if (!activeSessionState) {
                                    logger.warn('未找到待取消标记的 SSH 会话', { userId: ws.userId, sessionId: sessionToUnmarkId });
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_UNMARKED_FOR_SUSPEND_ACK', payload: { ...ackPayloadBase, success: false, error: '未找到要取消标记的会话' } as SshUnmarkedForSuspendAck['payload'] }));
                                    break;
                                }

                                if (!activeSessionState.isMarkedForSuspend) {
                                    logger.warn('SSH 会话未处于待挂起状态', { userId: ws.userId, sessionId: sessionToUnmarkId });
                                    // 即使未标记，也回复成功，因为最终状态是“未标记”
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_UNMARKED_FOR_SUSPEND_ACK', payload: { ...ackPayloadBase, success: true, error: '会话本就未标记' } as SshUnmarkedForSuspendAck['payload'] }));
                                    break;
                                }

                                try {
                                    activeSessionState.isMarkedForSuspend = false;
                                    const logPathToDelete = activeSessionState.suspendLogPath;
                                    activeSessionState.suspendLogPath = undefined; // 清除日志路径

                                    if (logPathToDelete) {
                                        await temporaryLogStorageService.deleteLog(logPathToDelete);
                                        logger.info('已删除挂起会话临时记录', { sessionId: sessionToUnmarkId });
                                    }

                                    logger.info('SSH 会话已取消待挂起标记', { userId: ws.userId, sessionId: sessionToUnmarkId });
                                    const response: SshUnmarkedForSuspendAck = {
                                        type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
                                        payload: { ...ackPayloadBase, success: true }
                                    };
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                                } catch (error: any) {
                                    logger.error('取消 SSH 会话待挂起标记失败', { userId: ws.userId, sessionId: sessionToUnmarkId, error });
                                    // 尝试回滚状态（尽管可能意义不大，因为错误可能在删除日志时发生）
                                    if (activeSessionState) {
                                         activeSessionState.isMarkedForSuspend = true; // 保持标记状态
                                         // activeSessionState.suspendLogPath = logPathToDelete; // 如果需要，可以恢复路径，但删除失败更可能是问题
                                    }
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_UNMARKED_FOR_SUSPEND_ACK', payload: { ...ackPayloadBase, success: false, error: error.message || '取消标记会话失败' } as SshUnmarkedForSuspendAck['payload'] }));
                                }
                                break;
                            }
                            default:
                                logger.warn('收到未知 WebSocket 消息类型', { userId: ws.userId, sessionId, messageType: type });
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', payload: `不支持的消息类型: ${type}` }));
                        }
                    } catch (error: any) {
                        logger.error('处理 WebSocket 消息时发生错误', { userId: ws.userId, sessionId, messageType: type, error });
                        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', payload: `处理消息时发生内部错误: ${error.message}` }));
                    }
                });
                if (!accepted && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'error', payload: '消息处理队列已超载，连接已关闭' }));
                    ws.close(1013, 'message queue overloaded');
                }
            });

            ws.on('close', (code, reason) => {
                logger.info('WebSocket 客户端已断开连接', { userId: ws.userId, sessionId: ws.sessionId, code });
                cleanupClientConnection(ws.sessionId);
            });

            ws.on('error', (error) => {
                logger.error('WebSocket 客户端发生错误', { userId: ws.userId, sessionId: ws.sessionId, error });
                cleanupClientConnection(ws.sessionId); // Ensure cleanup on error too
            });
        }
    });

    // 监听 SshSuspendService 发出的会话自动终止事件
    sshSuspendService.on('sessionAutoTerminated', (eventPayload: { userId: number; suspendSessionId: string; reason: string }) => {
        const { userId, suspendSessionId, reason } = eventPayload;
        logger.info('准备通知客户端挂起 SSH 会话已自动终止', { userId, sessionId: suspendSessionId });

        wss.clients.forEach(client => {
            const wsClient = client as AuthenticatedWebSocket; // 类型断言
            if (wsClient.userId === userId && wsClient.readyState === WebSocket.OPEN) {
                const notification: SshSuspendAutoTerminatedNotification = {
                    type: 'SSH_SUSPEND_AUTO_TERMINATED',
                    payload: {
                        suspendSessionId,
                        reason
                    }
                };
                wsClient.send(JSON.stringify(notification));
                logger.info('已通知客户端挂起 SSH 会话已自动终止', { userId, sessionId: suspendSessionId });
            }
        });
    });

    logger.info('WebSocket 连接处理器已初始化');
}

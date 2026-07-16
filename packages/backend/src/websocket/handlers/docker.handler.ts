import { AuthenticatedWebSocket, ClientState, DockerContainer, DockerStats } from '../types';
import { parsePortsString } from '../utils';
import { clientStates, settingsService } from '../state';
import WebSocket from 'ws';
import { createLogger } from '../../logging/logger';

const logger = createLogger('DockerWebSocketHandler');

const DEFAULT_DOCKER_STATUS_INTERVAL_SECONDS = 2;
const DOCKER_MANAGER_ENABLED_KEY = 'dockerManagerEnabled';

async function isDockerManagerEnabled(): Promise<boolean> {
    try {
        const enabled = await settingsService.getSetting(DOCKER_MANAGER_ENABLED_KEY);
        return enabled !== 'false';
    } catch (error) {
        logger.error('读取 Docker 管理开关失败，保留默认启用状态', { error });
        return true;
    }
}

export async function fetchRemoteDockerStatus(state: ClientState): Promise<{ available: boolean; containers: DockerContainer[] }> {
    if (!state || !state.sshClient) {
        logger.warn('无法采集 Docker 状态：SSH 客户端不可用', { sessionId: state?.ws?.sessionId });
        return { available: false, containers: [] };
    }

    let allContainers: DockerContainer[] = [];
    const statsMap = new Map<string, DockerStats>();

    try {
        const versionCommand = "docker version --format '{{.Server.Version}}'";
        const { stdout: versionStdout, stderr: versionStderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            if (!state.sshClient) {
                return reject(new Error('SSH client disconnected before command execution.'));
            }
            state.sshClient.exec(versionCommand, { pty: false }, (err, stream) => {
                if (err) return reject(err);
                stream.on('data', (data: Buffer) => { stdout += data.toString(); });
                stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
                stream.on('close', () => resolve({ stdout, stderr }));
                stream.on('error', (execErr: Error) => reject(execErr));
            });
        });

        if (versionStderr.includes('command not found') ||
            versionStderr.includes('permission denied') ||
            versionStderr.includes('Cannot connect to the Docker daemon')) {
            logger.warn('Docker 版本检查表明远端 Docker 不可用', { sessionId: state.ws.sessionId });
            return { available: false, containers: [] };
        } else if (versionStderr) {
            logger.warn('Docker 版本检查产生标准错误输出', { sessionId: state.ws.sessionId, byteLength: Buffer.byteLength(versionStderr) });
        }

        if (!versionStdout.trim()) {
            logger.warn('Docker 版本检查没有输出，视为不可用', { sessionId: state.ws.sessionId });
            return { available: false, containers: [] };
        }
    } catch (error: any) {
        logger.error('执行 Docker 版本检查失败', { sessionId: state.ws.sessionId, error });
        return { available: false, containers: [] };
    }

    try {
        const psCommand = "docker ps -a --no-trunc --format '{{json .}}'";
        const { stdout: psStdout, stderr: psStderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            if (!state.sshClient) {
                return reject(new Error('SSH client disconnected before command execution.'));
            }
            state.sshClient.exec(psCommand, { pty: false }, (err, stream) => {
                if (err) return reject(err);
                stream.on('data', (data: Buffer) => { stdout += data.toString(); });
                stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
                stream.on('close', () => resolve({ stdout, stderr }));
                stream.on('error', (execErr: Error) => reject(execErr));
            });
        });

        if (psStderr.includes('command not found') ||
            psStderr.includes('permission denied') ||
            psStderr.includes('Cannot connect to the Docker daemon')) {
            logger.warn('Docker 列表查询表明远端 Docker 不可用', { sessionId: state.ws.sessionId });
            return { available: false, containers: [] };
        } else if (psStderr) {
             logger.warn('Docker 列表查询产生标准错误输出', { sessionId: state.ws.sessionId, byteLength: Buffer.byteLength(psStderr) });
        }

        const lines = psStdout.trim() ? psStdout.trim().split('\n') : [];
        allContainers = lines
            .map(line => {
                try {
                    const data = JSON.parse(line);
                    const container: DockerContainer = {
                        id: data.ID,
                        Names: typeof data.Names === 'string' ? data.Names.split(',') : (data.Names || []),
                        Image: data.Image || '',
                        ImageID: data.ImageID || '',
                        Command: data.Command || '',
                        Created: data.CreatedAt || 0,
                        State: data.State || 'unknown',
                        Status: data.Status || '',
                        Ports: parsePortsString(data.Ports),
                        Labels: data.Labels || {},
                        stats: null
                    };
                    return container;
                } catch (parseError) {
                    logger.error('解析 Docker 容器状态失败', { sessionId: state.ws.sessionId, error: parseError });
                    return null;
                }
            })
            .filter((container): container is DockerContainer => container !== null);
    } catch (error: any) {
        logger.error('执行 Docker 列表查询失败', { sessionId: state.ws.sessionId, error });
        return { available: false, containers: [] };
    }

    const runningContainerIds = allContainers.filter(c => c.State === 'running').map(c => c.id);

    if (runningContainerIds.length > 0) {
        try {
            const statsCommand = `docker stats ${runningContainerIds.join(' ')} --no-stream --format '{{json .}}'`;
            const { stdout: statsStdout, stderr: statsStderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
                let stdout = '';
                let stderr = '';
                if (!state.sshClient) {
                    return reject(new Error('SSH client disconnected before command execution.'));
                }
                state.sshClient.exec(statsCommand, { pty: false }, (err, stream) => {
                    if (err) return reject(err);
                    stream.on('data', (data: Buffer) => { stdout += data.toString(); });
                    stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
                    stream.on('close', () => resolve({ stdout, stderr }));
                    stream.on('error', (execErr: Error) => reject(execErr));
                });
            });

            if (statsStderr) {
                logger.warn('Docker 指标查询产生标准错误输出', { sessionId: state.ws.sessionId, byteLength: Buffer.byteLength(statsStderr) });
            }

            const statsLines = statsStdout.trim() ? statsStdout.trim().split('\n') : [];
            statsLines.forEach(line => {
                try {
                    const statsData = JSON.parse(line) as DockerStats;
                    if (statsData.ID) {
                        statsMap.set(statsData.ID, statsData);
                    }
                } catch (parseError) {
                    logger.error('解析 Docker 指标状态失败', { sessionId: state.ws.sessionId, error: parseError });
                }
            });
        } catch (error: any) {
            logger.warn('执行 Docker 指标查询失败', { sessionId: state.ws.sessionId, error });
        }
    }

    allContainers.forEach(container => {
        const shortId = container.id.substring(0, 12);
        const stats = statsMap.get(container.id) || statsMap.get(shortId);
        if (stats) {
            container.stats = stats;
        }
    });

    return { available: true, containers: allContainers };
}

export async function handleDockerGetStatus(ws: AuthenticatedWebSocket, sessionId: string | undefined): Promise<void> {
    if (!(await isDockerManagerEnabled())) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:status:update', payload: { available: false, containers: [] } }));
        return;
    }
    const state = sessionId ? clientStates.get(sessionId) : undefined;
    if (!state) {
        logger.warn('收到 Docker 状态请求但无活动会话', { userId: ws.userId, sessionId });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:status:error', payload: { message: 'Session state not found.' } }));
        return;
    }
    if (!state.sshClient) {
        logger.warn('收到 Docker 状态请求但无活动 SSH 连接', { userId: ws.userId, sessionId });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:status:error', payload: { message: 'SSH connection not active.' } }));
        return;
    }
    try {
        const statusPayload = await fetchRemoteDockerStatus(state);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:status:update', payload: statusPayload }));
    } catch (error: any) {
        logger.error('手动获取 Docker 状态失败', { userId: ws.userId, sessionId, error });
        const errorMessage = error.message || 'Unknown error fetching status';
        const isUnavailable = errorMessage.includes('command not found') || errorMessage.includes('Cannot connect to the Docker daemon');
        if (ws.readyState === WebSocket.OPEN) {
            if (isUnavailable) {
                ws.send(JSON.stringify({ type: 'docker:status:update', payload: { available: false, containers: [] } }));
            } else {
                ws.send(JSON.stringify({ type: 'docker:status:error', payload: { message: `Failed to get remote Docker status: ${errorMessage}` } }));
            }
        }
    }
}

export async function handleDockerCommand(ws: AuthenticatedWebSocket, sessionId: string | undefined, payload: any): Promise<void> {
    if (!(await isDockerManagerEnabled())) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:command:error', payload: { command: payload?.command, message: 'Docker manager is disabled.' } }));
        return;
    }
    const state = sessionId ? clientStates.get(sessionId) : undefined;
    if (!state || !state.sshClient) {
        logger.warn('收到 Docker 命令请求但无活动 SSH 连接', { userId: ws.userId, sessionId });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:command:error', payload: { command: payload?.command, message: 'SSH connection not active.' } }));
        return;
    }
    const { containerId, command } = payload || {};
    if (!containerId || typeof containerId !== 'string' || !command || !['start', 'stop', 'restart', 'remove'].includes(command)) {
        logger.warn('收到无效的 Docker 命令请求', { userId: ws.userId, sessionId });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:command:error', payload: { command: command, message: 'Invalid containerId or command.' } }));
        return;
    }

    logger.info('正在执行 Docker 命令', { userId: ws.userId, sessionId, operation: command });
    try {
        const cleanContainerId = containerId.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!cleanContainerId) throw new Error('Invalid container ID format after sanitization.');

        let dockerCliCommand: string;
        switch (command) {
            case 'start': dockerCliCommand = `docker start ${cleanContainerId}`; break;
            case 'stop': dockerCliCommand = `docker stop ${cleanContainerId}`; break;
            case 'restart': dockerCliCommand = `docker restart ${cleanContainerId}`; break;
            case 'remove': dockerCliCommand = `docker rm -f ${cleanContainerId}`; break;
            default: throw new Error(`Unsupported command: ${command}`);
        }

        await new Promise<void>((resolve, reject) => {
            if (!state.sshClient) {
                return reject(new Error('SSH client disconnected before command execution.'));
            }
            state.sshClient.exec(dockerCliCommand, { pty: false }, (err, stream) => {
                if (err) return reject(err);
                let stderr = '';
                stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
                stream.on('close', (code: number | null) => {
                    if (code === 0) {
                        logger.info('Docker 命令执行成功', { sessionId, operation: command });
                        resolve();
                    } else {
                        logger.error('Docker 命令执行失败', { sessionId, operation: command, exitCode: code, stderrByteLength: Buffer.byteLength(stderr) });
                        reject(new Error(`Command failed with code ${code}. ${stderr || 'No stderr output.'}`));
                    }
                });
                stream.on('error', (execErr: Error) => reject(execErr));
            });
        });

        // Request a status update after a short delay
        setTimeout(() => {
            const currentState = clientStates.get(sessionId!); // Re-fetch state as it might have changed
            if (currentState && currentState.ws.readyState === WebSocket.OPEN) {
                currentState.ws.send(JSON.stringify({ type: 'request_docker_status_update' }));
            }
        }, 500);

    } catch (error: any) {
        logger.error('执行 Docker 命令失败', { userId: ws.userId, sessionId, operation: command, error });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:command:error', payload: { command, containerId, message: `Failed to execute remote command: ${error.message}` } }));
    }
}

export async function handleDockerGetStats(ws: AuthenticatedWebSocket, sessionId: string | undefined, payload: any): Promise<void> {
    if (!(await isDockerManagerEnabled())) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId: payload?.containerId, message: 'Docker manager is disabled.' } }));
        return;
    }
    const state = sessionId ? clientStates.get(sessionId) : undefined;
    if (!state || !state.sshClient) {
        logger.warn('收到 Docker 指标请求但无活动 SSH 连接', { userId: ws.userId, sessionId });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId: payload?.containerId, message: 'SSH connection not active.' } }));
        return;
    }
    if (!payload || !payload.containerId) {
        logger.warn('收到无效的 Docker 指标请求', { userId: ws.userId, sessionId });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId: payload?.containerId, message: 'Missing containerId.' } }));
        return;
    }

    const containerId = payload.containerId;
    logger.info('正在获取 Docker 指标', { userId: ws.userId, sessionId });
    const command = `docker stats ${containerId} --no-stream --format '{{json .}}'`;

    try {
        const execResult = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            if (!state.sshClient) {
                return reject(new Error('SSH client disconnected before command execution.'));
            }
            state.sshClient.exec(command, { pty: false }, (err, stream) => {
                if (err) return reject(err);
                stream.on('data', (data: Buffer) => { stdout += data.toString(); });
                stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
                stream.on('close', () => resolve({ stdout, stderr }));
                stream.on('error', (execErr: Error) => reject(execErr));
            });
        });

        if (execResult.stderr) {
            logger.error('Docker 指标查询产生标准错误输出', { sessionId, stderrByteLength: Buffer.byteLength(execResult.stderr) });
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId, message: execResult.stderr.trim() || 'Error executing stats command.' } }));
            return;
        }

        if (!execResult.stdout) {
            logger.warn('Docker 指标查询没有输出', { sessionId });
            if (!execResult.stderr && ws.readyState === WebSocket.OPEN) {
                 ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId, message: 'No stats data received (container might be stopped).' } }));
            }
            return;
        }

        try {
            const statsData = JSON.parse(execResult.stdout.trim());
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:stats:update', payload: { containerId, stats: statsData } }));
        } catch (parseError) {
            logger.error('解析 Docker 指标失败', { sessionId, error: parseError });
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId, message: 'Failed to parse stats data.' } }));
        }

    } catch (error: any) {
        logger.error('执行 Docker 指标查询失败', { sessionId, error });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId, message: error.message || 'Failed to fetch Docker stats.' } }));
    }
}

export async function startDockerStatusPolling(sessionId: string): Promise<void> {
    if (!(await isDockerManagerEnabled())) {
        logger.info('Docker 管理已禁用，跳过状态轮询', { sessionId });
        return;
    }
    const state = clientStates.get(sessionId);
    if (!state) {
        logger.warn('无法为不存在的会话启动 Docker 状态轮询', { sessionId });
        return;
    }

    const DOCKER_STATUS_BUFFERED_AMOUNT_LIMIT = 512 * 1024;

    logger.info('正在启动 Docker 状态轮询', { sessionId });
    let dockerPollIntervalMs = DEFAULT_DOCKER_STATUS_INTERVAL_SECONDS * 1000;
    try {
        const intervalSetting = await settingsService.getSetting('dockerStatusIntervalSeconds');
        if (intervalSetting) {
            const intervalSeconds = parseInt(intervalSetting, 10);
            if (!isNaN(intervalSeconds) && intervalSeconds >= 1) {
                dockerPollIntervalMs = intervalSeconds * 1000;
                logger.info('已应用 Docker 状态轮询间隔', { sessionId, intervalMs: dockerPollIntervalMs });
            } else {
                 logger.warn('Docker 状态轮询间隔无效，使用默认值', { sessionId, intervalMs: dockerPollIntervalMs });
            }
        } else {
            logger.info('未配置 Docker 状态轮询间隔，使用默认值', { sessionId, intervalMs: dockerPollIntervalMs });
        }
    } catch (settingError) {
         logger.error('读取 Docker 状态轮询间隔失败，使用默认值', { sessionId, intervalMs: dockerPollIntervalMs, error: settingError });
    }

    // Clear existing interval if any, to prevent multiple pollers for the same session
    if (state.dockerStatusIntervalId) {
        clearInterval(state.dockerStatusIntervalId);
        logger.info('已清除旧的 Docker 状态轮询', { sessionId });
    }

    const dockerIntervalId = setInterval(async () => {
        const currentState = clientStates.get(sessionId); // Re-fetch state in case it changed (e.g., disconnected)
        if (!currentState || currentState.ws.readyState !== WebSocket.OPEN || !currentState.sshClient) {
            logger.info('Docker 状态轮询因会话不可用而停止', { sessionId });
            clearInterval(dockerIntervalId);
            if (currentState && currentState.dockerStatusIntervalId === dockerIntervalId) { // Ensure we only delete our own interval ID
                delete currentState.dockerStatusIntervalId;
            }
            return;
        }
        if (currentState.ws.bufferedAmount > DOCKER_STATUS_BUFFERED_AMOUNT_LIMIT) {
            return;
        }
        try {
            if (!(await isDockerManagerEnabled())) {
                logger.info('Docker 管理已禁用，停止状态轮询', { sessionId });
                clearInterval(dockerIntervalId);
                if (currentState.dockerStatusIntervalId === dockerIntervalId) {
                    delete currentState.dockerStatusIntervalId;
                }
                return;
            }
            const statusPayload = await fetchRemoteDockerStatus(currentState);
            if (currentState.ws.readyState === WebSocket.OPEN) { // Check again before sending
                currentState.ws.send(JSON.stringify({ type: 'docker:status:update', payload: statusPayload }));
            }
            if (!statusPayload.available) {
                logger.info('Docker 不可用，停止状态轮询', { sessionId });
                clearInterval(dockerIntervalId);
                if (currentState.dockerStatusIntervalId === dockerIntervalId) {
                    delete currentState.dockerStatusIntervalId;
                }
            }
        } catch (error: any) {
            logger.error('Docker 状态轮询获取失败', { sessionId, error });
            // Optionally send an error to the client if polling fails consistently,
            // but be mindful of flooding the client with errors.
            // if (currentState.ws.readyState === WebSocket.OPEN) {
            //     currentState.ws.send(JSON.stringify({ type: 'docker:status:error', payload: { message: `Polling error: ${error.message}` } }));
            // }
        }
    }, dockerPollIntervalMs);
    state.dockerStatusIntervalId = dockerIntervalId;

    // Initial fetch
    const initialState = clientStates.get(sessionId);
    if (initialState && initialState.ws.readyState === WebSocket.OPEN && initialState.sshClient) {
        logger.info('正在初次获取 Docker 状态', { sessionId });
        try {
            const statusPayload = await fetchRemoteDockerStatus(initialState);
            if (initialState.ws.readyState === WebSocket.OPEN) { // Check again
                initialState.ws.send(JSON.stringify({ type: 'docker:status:update', payload: statusPayload }));
            }
            if (!statusPayload.available && initialState.dockerStatusIntervalId) {
                logger.info('初次获取发现 Docker 不可用，停止状态轮询', { sessionId });
                clearInterval(initialState.dockerStatusIntervalId);
                delete initialState.dockerStatusIntervalId;
            }
        } catch (error: any) {
            logger.error('初次获取 Docker 状态失败', { sessionId, error });
            if (initialState.ws.readyState === WebSocket.OPEN) {
                 const errorMessage = error.message || 'Unknown error during initial fetch';
                 const isUnavailable = errorMessage.includes('command not found') || errorMessage.includes('Cannot connect to the Docker daemon');
                 if (isUnavailable) {
                     initialState.ws.send(JSON.stringify({ type: 'docker:status:update', payload: { available: false, containers: [] } }));
                 } else {
                     initialState.ws.send(JSON.stringify({ type: 'docker:status:error', payload: { message: `Initial Docker status fetch failed: ${errorMessage}` } }));
                 }
            }
        }
    }
}

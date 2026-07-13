import { findFullConnectionById, updateLastConnected } from '../connections/connection.repository';
import { clientStates } from '../websocket/state';
import type { AuthenticatedWebSocket, ClientState } from '../websocket/types';
import { scheduleSshOutput } from '../websocket/ssh-output-buffer';
import { TelnetService } from './telnet.service';
import { AccessControlApplication } from '../access-control/access-control.application';
import { accessControlRepository } from '../access-control/access-control.repository';
import { finishSessionRecording, startSessionRecording } from '../session-recording/session-recording.service';
import { createLogger } from '../logging/logger';

const accessControlApplication = new AccessControlApplication(accessControlRepository);
const logger = createLogger('TelnetHandler');

interface TelnetConnectPayload {
  connectionId: number;
  frontendSessionId?: string;
}

interface TelnetInputPayload {
  sessionId: string;
  data: string;
}

interface TelnetResizePayload {
  sessionId: string;
  cols: number;
  rows: number;
}

interface TelnetDisconnectPayload {
  sessionId: string;
}

const sendJson = (ws: AuthenticatedWebSocket, type: string, payload: unknown) => {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type, payload }));
  }
};

const readTelnetService = (state?: ClientState) => state?.telnetService;

export async function handleTelnetConnect(ws: AuthenticatedWebSocket, payload: TelnetConnectPayload, request?: { clientIpAddress?: string }): Promise<void> {
  const connectionId = Number(payload.connectionId);
  if (!ws.authorization) {
    sendJson(ws, 'telnet:error', { code: 'ACCESS_DENIED' });
    return;
  }
  try {
    await accessControlApplication.requireConnectionPermission(ws.authorization, connectionId, 'connect');
  } catch {
    sendJson(ws, 'telnet:error', { code: 'ACCESS_DENIED' });
    return;
  }
  const connection = await findFullConnectionById(connectionId);
  if (!connection) {
    sendJson(ws, 'telnet:error', { message: '连接配置不存在' });
    return;
  }
  if (connection.type !== 'TELNET') {
    sendJson(ws, 'telnet:error', { message: '此连接类型不是 Telnet。' });
    return;
  }

  const telnetService = new TelnetService({
    host: connection.host,
    port: connection.port || 23,
    timeout: 10000,
  });
  const result = await telnetService.connect();
  if (!result.success) {
    sendJson(ws, 'telnet:error', { message: result.error || '连接失败' });
    return;
  }

  const sessionId = payload.frontendSessionId || ws.sessionId;
  if (!sessionId) {
    sendJson(ws, 'telnet:error', { message: '缺少前端会话标识' });
    return;
  }
  const clientState: ClientState = {
    ws,
    sshClient: null as unknown as ClientState['sshClient'],
    dbConnectionId: connectionId,
    connectionName: connection.name || connection.host,
    connectedAt: Date.now(),
    ipAddress: request?.clientIpAddress,
    isShellReady: true,
    telnetService,
    telnetSessionId: sessionId,
  };

  try {
    clientState.sessionRecorder = await startSessionRecording({
      userId: ws.userId,
      username: ws.username,
      connectionId,
      connectionName: connection.name || connection.host,
      protocol: 'TELNET',
    });
  } catch (error) {
    logger.error('Telnet 会话启动录像失败', { sessionId, connectionId, error });
  }

  clientStates.set(sessionId, clientState);
  ws.sessionId = sessionId;

  telnetService.onData((data) => {
    clientState.sessionRecorder?.recordOutput(data);
    scheduleSshOutput(clientState, data);
  });
  telnetService.onClose(() => {
    sendJson(ws, 'telnet:disconnected', { sessionId });
    clientStates.delete(sessionId);
    void finishSessionRecording(clientState.sessionRecorder);
  });
  telnetService.onError((error) => {
    sendJson(ws, 'telnet:error', { sessionId, message: error.message });
  });

  await updateLastConnected(connectionId, Math.floor(Date.now() / 1000));
  sendJson(ws, 'telnet:connected', {
    connectionId,
    sessionId,
    serverCapabilities: { sshBinaryInput: false, sshBinaryOutput: true },
  });
}

export function handleTelnetInput(ws: AuthenticatedWebSocket, payload: TelnetInputPayload): void {
  const state = clientStates.get(payload.sessionId);
  if (!state || state.ws !== ws) return;
  const data = Buffer.from(payload.data, 'base64');
  if (process.env.SESSION_RECORD_INPUT !== 'false') state.sessionRecorder?.recordInput(data);
  readTelnetService(state)?.write(data);
}

export function handleTelnetResize(ws: AuthenticatedWebSocket, payload: TelnetResizePayload): void {
  const state = clientStates.get(payload.sessionId);
  if (!state || state.ws !== ws) return;
  readTelnetService(state)?.resize(payload.cols, payload.rows);
  state.sessionRecorder?.recordResize(payload.cols, payload.rows);
}

export function handleTelnetDisconnect(_ws: AuthenticatedWebSocket, payload: TelnetDisconnectPayload): void {
  const state = clientStates.get(payload.sessionId);
  readTelnetService(state)?.disconnect();
  void finishSessionRecording(state?.sessionRecorder);
  clientStates.delete(payload.sessionId);
}

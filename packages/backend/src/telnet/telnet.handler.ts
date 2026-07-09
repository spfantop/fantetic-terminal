import { findFullConnectionById, updateLastConnected } from '../connections/connection.repository';
import { clientStates } from '../websocket/state';
import type { AuthenticatedWebSocket, ClientState } from '../websocket/types';
import { scheduleSshOutput } from '../websocket/ssh-output-buffer';
import { TelnetService } from './telnet.service';

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

  clientStates.set(sessionId, clientState);
  ws.sessionId = sessionId;

  telnetService.onData((data) => {
    scheduleSshOutput(clientState, data);
  });
  telnetService.onClose(() => {
    sendJson(ws, 'telnet:disconnected', { sessionId });
    clientStates.delete(sessionId);
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
  readTelnetService(state)?.write(Buffer.from(payload.data, 'base64'));
}

export function handleTelnetResize(ws: AuthenticatedWebSocket, payload: TelnetResizePayload): void {
  const state = clientStates.get(payload.sessionId);
  if (!state || state.ws !== ws) return;
  readTelnetService(state)?.resize(payload.cols, payload.rows);
}

export function handleTelnetDisconnect(_ws: AuthenticatedWebSocket, payload: TelnetDisconnectPayload): void {
  const state = clientStates.get(payload.sessionId);
  readTelnetService(state)?.disconnect();
  clientStates.delete(payload.sessionId);
}

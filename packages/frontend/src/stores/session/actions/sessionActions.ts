import type { WsConnectionStatus } from '../../../composables/useWebSocketConnection';
import { debugLog } from '../../../composables/useDebugLog';
import { isRemoteDesktopFeatureAvailable } from '../../../utils/runtimeConfig';
import type { ConnectionInfo } from '../../connections.store';
import { activeSessionId, poppedOutSessionIds, sessions } from '../state';
import type { SessionState } from '../types';
import { generateSessionId } from '../utils';

const isTerminalShellSessionKind = (kind?: string) => kind === 'ssh' || kind === 'telnet';

export const openRemoteDesktopSession = (connection: ConnectionInfo): string | null => {
  if (connection.type !== 'RDP' && connection.type !== 'VNC') {
    console.warn(`[SessionActions] openRemoteDesktopSession 仅用于 RDP/VNC，会话类型为 ${connection.type}。`);
    return null;
  }
  if (!isRemoteDesktopFeatureAvailable()) {
    console.warn('[SessionActions] Electron App 未内置 guacd，已禁用 RDP/VNC 会话。');
    return null;
  }

  const newSessionId = generateSessionId();
  const newSession = {
    sessionId: newSessionId,
    connectionId: String(connection.id),
    connectionName: connection.name || connection.host,
    kind: connection.type === 'RDP' ? 'rdp' : 'vnc',
    connection,
    rdpStatus: 'connecting',
    rdpStatusMessage: '',
    createdAt: Date.now(),
  } as unknown as SessionState;

  sessions.value = new Map(sessions.value).set(newSessionId, newSession);
  activeSessionId.value = newSessionId;
  debugLog(`[SessionActions] 已创建 ${connection.type} 会话实例: ${newSessionId} for connection ${connection.id}`);
  return newSessionId;
};

export const openRdpSession = (connection: ConnectionInfo): string | null => {
  if (connection.type !== 'RDP') {
    console.warn(`[SessionActions] openRdpSession 仅用于 RDP，会话类型为 ${connection.type}。`);
    return null;
  }
  return openRemoteDesktopSession(connection);
};

export const updateRdpSessionStatus = (
  sessionId: string,
  status: WsConnectionStatus,
  message: string,
) => {
  const session = sessions.value.get(sessionId);
  if (!session || (session.kind !== 'rdp' && session.kind !== 'vnc')) return;

  session.rdpStatus = status;
  session.rdpStatusMessage = message;
  sessions.value = new Map(sessions.value);
};

export const setTerminalSingleLineOutput = (sessionId: string, enabled: boolean) => {
  const session = sessions.value.get(sessionId);
  if (!session || !isTerminalShellSessionKind(session.kind)) return;

  session.terminalSingleLineOutput = enabled;
  sessions.value = new Map(sessions.value);
};

export const toggleTerminalSingleLineOutput = (sessionId: string) => {
  const session = sessions.value.get(sessionId);
  if (!session || !isTerminalShellSessionKind(session.kind)) return;
  setTerminalSingleLineOutput(sessionId, !session.terminalSingleLineOutput);
};

export const closeRemoteDesktopSession = (sessionId: string): boolean => {
  const session = sessions.value.get(sessionId);
  if (!session || (session.kind !== 'rdp' && session.kind !== 'vnc')) return false;

  const nextSessions = new Map(sessions.value);
  nextSessions.delete(sessionId);
  sessions.value = nextSessions;
  poppedOutSessionIds.value = poppedOutSessionIds.value.filter(id => id !== sessionId);
  if (activeSessionId.value === sessionId) {
    const visibleSessionIdList = Array.from(nextSessions.keys())
      .filter(id => !poppedOutSessionIds.value.includes(id));
    activeSessionId.value = visibleSessionIdList.at(-1) ?? null;
  }
  debugLog(`[SessionActions] 已关闭远程桌面会话: ${sessionId}`);
  return true;
};

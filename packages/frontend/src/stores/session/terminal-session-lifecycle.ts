import { ref } from 'vue';
import type { ComposerTranslation } from 'vue-i18n';

import { createDockerManager, type DockerManagerDependencies } from '../../composables/useDockerManager';
import { createSshTerminalManager, type SshTerminalDependencies } from '../../composables/useSshTerminal';
import { createStatusMonitorManager, type StatusMonitorDependencies } from '../../composables/useStatusMonitor';
import { createWebSocketConnectionManager } from '../../composables/useWebSocketConnection';
import { debugLog } from '../../composables/useDebugLog';
import type {
  MessagePayload,
  SshMarkedForSuspendAckPayload,
  SshOutputCachedChunkPayload,
  SshSuspendAutoTerminatedNotifPayload,
  SshSuspendEntryRemovedRespPayload,
  SshSuspendListResponsePayload,
  SshSuspendResumedNotifPayload,
  SshSuspendResumeReqMessage,
  SshSuspendTerminatedRespPayload,
  SshUnmarkedForSuspendAckPayload,
} from '../../types/websocket.types';
import { waitForRefValue } from '../../utils/asyncScheduling';
import { resolveWebSocketBaseUrl } from '../../utils/runtimeConfig';
import type { ConnectionInfo } from '../connections.store';
import type { useConnectionsStore } from '../connections.store';
import { useUiNotificationsStore } from '../uiNotifications.store';
import {
  activeSessionId,
  isLoadingSuspendedSessions,
  poppedOutSessionIds,
  sessions,
  suspendedSshSessions,
} from './state';
import type { SessionState, SftpManagerInstance, SshSessionState, WsManagerInstance } from './types';
import { generateSessionId } from './utils';

interface TerminalSessionLifecycleDependencies {
  connectionsStore: ReturnType<typeof useConnectionsStore>;
  t: ComposerTranslation;
}

export interface TerminalSessionLifecycle {
  connect(connection: ConnectionInfo): string | null;
  open(connectionOrId: ConnectionInfo | number | string): string | null;
  resume(suspendSessionId: string): Promise<string | null>;
  activate(sessionId: string): boolean;
  close(sessionId: string): boolean;
}

const readConnection = (
  connectionOrId: ConnectionInfo | number | string,
  connectionsStore: ReturnType<typeof useConnectionsStore>,
): ConnectionInfo | undefined => {
  if (typeof connectionOrId === 'object' && connectionOrId !== null) return connectionOrId;
  return connectionsStore.connections.find(connection => connection.id === Number(connectionOrId));
};

export const createTerminalSessionLifecycle = (
  dependencies: TerminalSessionLifecycleDependencies,
): TerminalSessionLifecycle => {
  const { connectionsStore, t } = dependencies;

  const activate = (sessionId: string): boolean => {
    if (!sessions.value.has(sessionId)) return false;
    activeSessionId.value = sessionId;
    return true;
  };

  const registerSuspendProjectionHandlers = (
    wsManager: WsManagerInstance,
    disposables: Array<() => void>,
  ) => {
    disposables.push(wsManager.onMessage('SSH_MARKED_FOR_SUSPEND_ACK', (payload: MessagePayload) => {
      const result = payload as SshMarkedForSuspendAckPayload;
      const session = sessions.value.get(result.sessionId);
      if (session) {
        session.isMarkedForSuspend = result.success;
        sessions.value = new Map(sessions.value);
      }
      if (!result.success) {
        useUiNotificationsStore().addNotification({
          type: 'error',
          message: t('sshSuspend.notifications.markForSuspendError', {
            error: result.error || t('term.unknownError'),
          }),
        });
      }
    }));

    disposables.push(wsManager.onMessage('SSH_UNMARKED_FOR_SUSPEND_ACK', (payload: MessagePayload) => {
      const result = payload as SshUnmarkedForSuspendAckPayload;
      const session = sessions.value.get(result.sessionId);
      if (result.success && session) {
        session.isMarkedForSuspend = false;
        sessions.value = new Map(sessions.value);
      }
      useUiNotificationsStore().addNotification({
        type: result.success ? 'success' : 'error',
        message: result.success
          ? t('sshSuspend.notifications.unmarkedSuccess', { id: result.sessionId.slice(0, 8) })
          : t('sshSuspend.notifications.unmarkError', { error: result.error || t('term.unknownError') }),
      });
    }));

    disposables.push(wsManager.onMessage('SSH_SUSPEND_RESUMED_NOTIF', (payload: MessagePayload) => {
      const result = payload as SshSuspendResumedNotifPayload;
      const uiNotificationsStore = useUiNotificationsStore();
      if (!result.success) {
        uiNotificationsStore.addNotification({
          type: 'error',
          message: t('sshSuspend.notifications.resumeErrorBackend', {
            error: result.error || t('term.unknownError'),
          }),
        });
        close(result.newFrontendSessionId);
        return;
      }

      const session = sessions.value.get(result.newFrontendSessionId);
      if (!session) {
        uiNotificationsStore.addNotification({
          type: 'error',
          message: t('sshSuspend.notifications.resumeErrorGeneric', {
            error: t('term.unknownError'),
          }),
        });
        return;
      }

      const suspendedSession = suspendedSshSessions.value.find(
        item => item.suspendSessionId === result.suspendSessionId,
      );
      session.isResuming = true;
      sessions.value = new Map(sessions.value);
      activate(result.newFrontendSessionId);
      suspendedSshSessions.value = suspendedSshSessions.value.filter(
        item => item.suspendSessionId !== result.suspendSessionId,
      );
      uiNotificationsStore.addNotification({
        type: 'success',
        message: t('sshSuspend.notifications.resumeSuccess', {
          name: suspendedSession?.customSuspendName
            || suspendedSession?.connectionName
            || t('sshSuspend.notifications.defaultSessionName'),
        }),
      });
    }));

    disposables.push(wsManager.onMessage('SSH_OUTPUT_CACHED_CHUNK', (payload: MessagePayload) => {
      const result = payload as SshOutputCachedChunkPayload;
      sessions.value.get(result.frontendSessionId)?.terminalManager.writeOutput(result.data);
    }));

    disposables.push(wsManager.onMessage('SSH_SUSPEND_LIST_RESPONSE', (payload: MessagePayload) => {
      const result = payload as SshSuspendListResponsePayload;
      suspendedSshSessions.value = result.suspendSessions;
      isLoadingSuspendedSessions.value = false;
    }));

    disposables.push(wsManager.onMessage('SSH_SUSPEND_TERMINATED_RESP', (payload: MessagePayload) => {
      const result = payload as SshSuspendTerminatedRespPayload;
      const session = suspendedSshSessions.value.find(item => item.suspendSessionId === result.suspendSessionId);
      if (!result.success) {
        useUiNotificationsStore().addNotification({
          type: 'error',
          message: t('sshSuspend.notifications.terminateError', {
            error: result.error || t('term.unknownError'),
          }),
        });
        return;
      }
      suspendedSshSessions.value = suspendedSshSessions.value.filter(
        item => item.suspendSessionId !== result.suspendSessionId,
      );
      if (session) {
        useUiNotificationsStore().addNotification({
          type: 'info',
          message: t('sshSuspend.notifications.terminatedSuccess', {
            name: session.customSuspendName || session.connectionName,
          }),
        });
      }
    }));

    disposables.push(wsManager.onMessage('SSH_SUSPEND_ENTRY_REMOVED_RESP', (payload: MessagePayload) => {
      const result = payload as SshSuspendEntryRemovedRespPayload;
      const session = suspendedSshSessions.value.find(item => item.suspendSessionId === result.suspendSessionId);
      if (!result.success) {
        useUiNotificationsStore().addNotification({
          type: 'error',
          message: t('sshSuspend.notifications.entryRemovedError', {
            error: result.error || t('term.unknownError'),
          }),
        });
        return;
      }
      suspendedSshSessions.value = suspendedSshSessions.value.filter(
        item => item.suspendSessionId !== result.suspendSessionId,
      );
      if (session) {
        useUiNotificationsStore().addNotification({
          type: 'info',
          message: t('sshSuspend.notifications.entryRemovedSuccess', {
            name: session.customSuspendName || session.connectionName,
          }),
        });
      }
    }));

    disposables.push(wsManager.onMessage('SSH_SUSPEND_AUTO_TERMINATED_NOTIF', (payload: MessagePayload) => {
      const result = payload as SshSuspendAutoTerminatedNotifPayload;
      const session = suspendedSshSessions.value.find(item => item.suspendSessionId === result.suspendSessionId);
      if (!session) return;
      session.backendSshStatus = 'disconnected_by_backend';
      session.disconnectionTimestamp = new Date().toISOString();
      suspendedSshSessions.value = [...suspendedSshSessions.value];
      useUiNotificationsStore().addNotification({
        type: 'warning',
        message: t('sshSuspend.notifications.autoTerminated', {
          name: session.customSuspendName || session.connectionName,
          reason: result.reason,
        }),
      });
    }));
  };

  const createSession = (
    connection: ConnectionInfo,
    options?: { sessionId?: string; isResumeFlow?: boolean },
  ): string | null => {
    if (connection.type !== 'SSH' && connection.type !== 'TELNET') return null;

    const sessionId = options?.sessionId ?? generateSessionId();
    let currentSessionId = sessionId;
    const connectionId = String(connection.id);
    const protocol = connection.type === 'TELNET' ? 'telnet' : 'ssh';
    const partialSession: Omit<
      SshSessionState,
      'wsManager' | 'sftpManagers' | 'terminalManager' | 'statusMonitorManager' | 'dockerManager'
    > = {
      sessionId,
      connectionId,
      connectionName: connection.name || connection.host,
      kind: protocol,
      editorTabs: ref([]),
      activeEditorTabId: ref(null),
      terminalSingleLineOutput: false,
      isMarkedForSuspend: false,
      createdAt: Date.now(),
      disposables: [],
    };

    const wsManager = createWebSocketConnectionManager(sessionId, connectionId, t, {
      isResumeFlow: options?.isResumeFlow ?? false,
      getIsMarkedForSuspend: () => Boolean(sessions.value.get(currentSessionId)?.isMarkedForSuspend),
      protocol,
    });

    const terminalDependencies: SshTerminalDependencies = {
      sendMessage: wsManager.sendMessage,
      sendSshInput: wsManager.sendSshInput,
      sendTelnetInput: wsManager.sendTelnetInput,
      onMessage: wsManager.onMessage,
      onSshOutput: wsManager.onSshOutput,
      isConnected: wsManager.isConnected,
    };
    const statusMonitorDependencies: StatusMonitorDependencies = {
      onMessage: wsManager.onMessage,
      isConnected: wsManager.isConnected,
    };
    const dockerDependencies: DockerManagerDependencies = {
      sendMessage: wsManager.sendMessage,
      onMessage: wsManager.onMessage,
      isConnected: wsManager.isConnected,
    };

    const session: SessionState = {
      ...partialSession,
      wsManager,
      sftpManagers: new Map<string, SftpManagerInstance>(),
      terminalManager: createSshTerminalManager(sessionId, terminalDependencies, t, { protocol }),
      statusMonitorManager: createStatusMonitorManager(sessionId, statusMonitorDependencies),
      dockerManager: createDockerManager(sessionId, dockerDependencies, { t }),
    };

    sessions.value = new Map(sessions.value).set(sessionId, session);
    activeSessionId.value = sessionId;

    const initialSessionId = sessionId;
    session.disposables?.push(wsManager.onMessage(
      protocol === 'telnet' ? 'telnet:connected' : 'ssh:connected',
      (payload: MessagePayload) => {
        if (!payload || typeof payload !== 'object') return;
        const result = payload as { sessionId?: unknown; connectionId?: unknown };
        const backendSessionId = typeof result.sessionId === 'string' ? result.sessionId : '';
        if (!backendSessionId || String(result.connectionId) !== connectionId) return;

        const sessionToRekey = sessions.value.get(initialSessionId);
        if (!sessionToRekey || backendSessionId === initialSessionId) return;
        const nextSessions = new Map(sessions.value);
        nextSessions.delete(initialSessionId);
        sessionToRekey.sessionId = backendSessionId;
        nextSessions.set(backendSessionId, sessionToRekey);
        sessions.value = nextSessions;
        currentSessionId = backendSessionId;
        if (activeSessionId.value === initialSessionId) activeSessionId.value = backendSessionId;
        poppedOutSessionIds.value = poppedOutSessionIds.value.map(id => (
          id === initialSessionId ? backendSessionId : id
        ));
      },
    ));

    if (protocol === 'ssh') registerSuspendProjectionHandlers(wsManager, session.disposables ?? []);
    wsManager.connect(resolveWebSocketBaseUrl());
    debugLog(`[TerminalSessionLifecycle] Opened ${protocol} session ${sessionId}.`);
    return sessionId;
  };

  const open = (connectionOrId: ConnectionInfo | number | string): string | null => {
    const connection = readConnection(connectionOrId, connectionsStore);
    return connection ? createSession(connection) : null;
  };

  const close = (sessionId: string): boolean => {
    const session = sessions.value.get(sessionId);
    if (!session || (session.kind !== 'ssh' && session.kind !== 'telnet')) return false;

    session.wsManager.disconnect();
    session.sftpManagers.forEach(manager => manager.cleanup());
    session.sftpManagers.clear();
    session.terminalManager.cleanup();
    for (const dispose of session.disposables ?? []) {
      try {
        dispose();
      } catch (error) {
        console.error('[TerminalSessionLifecycle] Failed to dispose a session handler.', error);
      }
    }
    session.disposables = [];
    session.statusMonitorManager.cleanup();
    session.dockerManager.cleanup();

    const nextSessions = new Map(sessions.value);
    nextSessions.delete(sessionId);
    sessions.value = nextSessions;
    poppedOutSessionIds.value = poppedOutSessionIds.value.filter(id => id !== sessionId);
    if (activeSessionId.value === sessionId) {
      const visibleSessionIdList = Array.from(nextSessions.keys())
        .filter(id => !poppedOutSessionIds.value.includes(id));
      activeSessionId.value = visibleSessionIdList.at(-1) ?? null;
    }
    return true;
  };

  const connect = (connection: ConnectionInfo): string | null => {
    if (connection.type !== 'SSH' && connection.type !== 'TELNET') return null;
    if (connection.type === 'SSH' && activeSessionId.value) {
      const activeSession = sessions.value.get(activeSessionId.value);
      const status = activeSession?.wsManager.connectionStatus.value;
      if (
        activeSession?.kind === 'ssh'
        && activeSession.connectionId === String(connection.id)
        && (status === 'disconnected' || status === 'error')
      ) {
        activeSession.wsManager.connect(resolveWebSocketBaseUrl());
        return activeSession.sessionId;
      }
    }
    return open(connection);
  };

  const resume = async (suspendSessionId: string): Promise<string | null> => {
    const uiNotificationsStore = useUiNotificationsStore();
    const suspendedSession = suspendedSshSessions.value.find(
      session => session.suspendSessionId === suspendSessionId,
    );
    if (!suspendedSession) {
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.resumeErrorInfoNotFound', {
          id: suspendSessionId.slice(0, 8),
        }),
      });
      return null;
    }

    const connection = readConnection(suspendedSession.connectionId, connectionsStore);
    if (!connection || connection.type !== 'SSH') {
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.resumeErrorConnectionConfigNotFound', {
          id: suspendedSession.connectionId,
        }),
      });
      return null;
    }

    const newFrontendSessionId = generateSessionId();
    try {
      if (!createSession(connection, { sessionId: newFrontendSessionId, isResumeFlow: true })) {
        throw new Error('ssh-resume-initialization-failed');
      }
      const session = sessions.value.get(newFrontendSessionId);
      if (!session) throw new Error('ssh-resume-session-unavailable');

      const connected = await waitForRefValue(session.wsManager.isConnected, value => value, 5000);
      if (!connected) throw new Error('ssh-resume-websocket-timeout');

      const message: SshSuspendResumeReqMessage = {
        type: 'SSH_SUSPEND_RESUME_REQUEST',
        payload: {
          suspendSessionId,
          newFrontendSessionId,
          clientCapabilities: { sshBinaryOutput: true, sshBinaryInput: true },
        },
      };
      session.wsManager.sendMessage(message);
      return newFrontendSessionId;
    } catch (error) {
      close(newFrontendSessionId);
      console.error('[TerminalSessionLifecycle] Failed to resume SSH session.', error);
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.resumeErrorGeneric', { error: t('term.unknownError') }),
      });
      return null;
    }
  };

  return { connect, open, resume, activate, close };
};

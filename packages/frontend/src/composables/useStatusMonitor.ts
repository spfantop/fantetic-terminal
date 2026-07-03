import { ref, readonly, watch, type Ref, type ComputedRef } from 'vue';
import type { ServerStatus } from '../types/server.types';
import type { ConnectionRoutePlan, MessagePayload, WebSocketMessage } from '../types/websocket.types';
import { useLayoutStore } from '../stores/layout.store';
import { debugLog } from './useDebugLog';

export interface StatusMonitorDependencies {
  onMessage: (type: string, handler: (payload: any, fullMessage?: WebSocketMessage) => void) => () => void;
  isConnected: ComputedRef<boolean>;
}

export function createStatusMonitorManager(sessionId: string, wsDeps: StatusMonitorDependencies) {
  const { onMessage, isConnected } = wsDeps;
  const MAX_HISTORY_POINTS = 60;

  const serverStatus = ref<ServerStatus | null>(null);
  const statusError = ref<string | null>(null);
  const routePlan = ref<ConnectionRoutePlan | null>(null);

  const cpuHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null));
  const memUsedHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null));
  const netRxHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null));
  const netTxHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null));

  let pendingStatus: ServerStatus | null = null;
  let pendingFrameId: number | null = null;

  const updateHistory = (historyRef: Ref<(number | null)[]>, newValue: number | undefined) => {
    const nextHistory = historyRef.value.slice(1);
    nextHistory.push(
      newValue === undefined || newValue === null || Number.isNaN(newValue) ? null : newValue
    );
    historyRef.value = nextHistory;
  };

  const normalizeCpuCorePercents = (values: unknown): number[] | undefined => {
    if (!Array.isArray(values)) return undefined;

    return values.map((value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
      return Math.max(0, Math.min(100, Number(value.toFixed(1))));
    });
  };

  const commitStatus = (newStatus: ServerStatus) => {
    serverStatus.value = newStatus;
    statusError.value = null;

    updateHistory(cpuHistory, newStatus.cpuPercent);
    updateHistory(memUsedHistory, newStatus.memUsed);
    updateHistory(netRxHistory, newStatus.netRxRate);
    updateHistory(netTxHistory, newStatus.netTxRate);
  };

  const scheduleStatusCommit = (newStatus: ServerStatus) => {
    pendingStatus = newStatus;

    if (typeof window === 'undefined') {
      commitStatus(newStatus);
      pendingStatus = null;
      return;
    }

    if (pendingFrameId !== null) return;

    pendingFrameId = window.requestAnimationFrame(() => {
      pendingFrameId = null;
      if (!pendingStatus) return;
      commitStatus(pendingStatus);
      pendingStatus = null;
    });
  };

  const handleStatusUpdate = (payload: MessagePayload, message?: WebSocketMessage) => {
    if (message?.sessionId && message.sessionId !== sessionId) return;

    if (payload?.status) {
      scheduleStatusCommit({
        ...(payload.status as ServerStatus),
        cpuCorePercents: normalizeCpuCorePercents((payload.status as ServerStatus).cpuCorePercents),
      });
      return;
    }

    console.warn(`[会话 ${sessionId}][状态监控模块] 收到无效的 status_update 消息`);
  };

  const handleStatusError = (payload: MessagePayload, message?: WebSocketMessage) => {
    if (message?.sessionId && message.sessionId !== sessionId) return;

    console.error(`[会话 ${sessionId}][状态监控模块] 收到状态错误消息:`, payload);
    if (typeof payload === 'string') {
      statusError.value = payload;
    } else if (payload && typeof payload === 'object' && 'message' in payload) {
      statusError.value = String(payload.message);
    } else {
      statusError.value = '获取服务器状态时发生未知错误';
    }
    serverStatus.value = null;
  };

  const handleRoutePlan = (payload: MessagePayload, message?: WebSocketMessage) => {
    if (message?.sessionId && message.sessionId !== sessionId) return;
    routePlan.value = payload as ConnectionRoutePlan;
  };

  let unregisterUpdate: (() => void) | null = null;
  let unregisterError: (() => void) | null = null;
  let unregisterLegacyError: (() => void) | null = null;
  let unregisterRoutePlan: (() => void) | null = null;

  const registerStatusHandlers = () => {
    if (unregisterUpdate || unregisterError || unregisterLegacyError || unregisterRoutePlan) {
      debugLog(`[会话 ${sessionId}][状态监控模块] 处理器已注册，跳过。`);
      return;
    }
    if (isConnected.value) {
      debugLog(`[会话 ${sessionId}][状态监控模块] 注册状态消息处理器。`);
      unregisterUpdate = onMessage('status_update', handleStatusUpdate);
      unregisterError = onMessage('status:error', handleStatusError);
      unregisterLegacyError = onMessage('status_error', handleStatusError);
      unregisterRoutePlan = onMessage('ssh:route_plan', handleRoutePlan);
    } else {
      console.warn(`[会话 ${sessionId}][状态监控模块] WebSocket 未连接，无法注册状态处理器。`);
    }
  };

  const unregisterAllStatusHandlers = () => {
    if (unregisterUpdate || unregisterError || unregisterLegacyError || unregisterRoutePlan) {
      debugLog(`[会话 ${sessionId}][状态监控模块] 注销状态消息处理器。`);
      unregisterUpdate?.();
      unregisterError?.();
      unregisterLegacyError?.();
      unregisterRoutePlan?.();
      unregisterUpdate = null;
      unregisterError = null;
      unregisterLegacyError = null;
      unregisterRoutePlan = null;
    }
  };

  watch(isConnected, (newValue, oldValue) => {
    debugLog(`[会话 ${sessionId}][状态监控模块] 连接状态变化: ${oldValue} -> ${newValue}`);
    if (newValue) {
      const layoutStore = useLayoutStore();
      if (layoutStore.usedPanes.has('statusMonitor')) {
        registerStatusHandlers();
      } else {
        debugLog(`[会话 ${sessionId}][状态监控模块] 状态监视器不在布局中，跳过注册处理器。`);
      }
    } else {
      unregisterAllStatusHandlers();
      serverStatus.value = null;
      if (oldValue === true) {
        statusError.value = '连接已断开';
      }
    }
  });

  const cleanup = () => {
    unregisterAllStatusHandlers();
    if (pendingFrameId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(pendingFrameId);
    }
    pendingFrameId = null;
    pendingStatus = null;
    debugLog(`[会话 ${sessionId}][状态监控模块] 已清理。`);
  };

  return {
    serverStatus: readonly(serverStatus),
    statusError: readonly(statusError),
    routePlan: readonly(routePlan),
    cpuHistory: readonly(cpuHistory),
    memUsedHistory: readonly(memUsedHistory),
    netRxHistory: readonly(netRxHistory),
    netTxHistory: readonly(netTxHistory),
    registerStatusHandlers,
    unregisterAllStatusHandlers,
    cleanup,
  };
}

export function useStatusMonitor() {
  console.warn('⚠️ 使用已弃用的 useStatusMonitor() 全局单例。请迁移到 createStatusMonitorManager() 工厂函数。');

  const serverStatus = ref<ServerStatus | null>(null);
  const statusError = ref<string | null>(null);

  const registerStatusHandlers = () => {
    console.warn('[状态监控模块][旧] 调用了已弃用的 registerStatusHandlers');
  };

  const unregisterAllStatusHandlers = () => {
    console.warn('[状态监控模块][旧] 调用了已弃用的 unregisterAllStatusHandlers');
  };

  return {
    serverStatus: readonly(serverStatus),
    statusError: readonly(statusError),
    registerStatusHandlers,
    unregisterAllStatusHandlers,
  };
}

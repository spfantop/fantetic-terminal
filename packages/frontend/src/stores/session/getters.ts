// packages/frontend/src/stores/session/getters.ts

import { computed } from 'vue';
import { sessions, activeSessionId } from './state';
import type { SessionState, SessionTabInfoWithStatus } from './types';
import { debugLog } from '../../composables/useDebugLog';

const SESSION_ORDER_STORAGE_KEY = 'sessionOrder';
export const SESSION_ORDER_UPDATED_EVENT = 'fantetic:session-order-updated';

let cachedSessionOrderRaw: string | null = null;
let cachedSessionOrder: string[] = [];

const readStoredSessionOrder = () => {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  return localStorage.getItem(SESSION_ORDER_STORAGE_KEY);
};

const readSessionOrder = () => {
  const sessionOrderStr = readStoredSessionOrder();
  if (sessionOrderStr === cachedSessionOrderRaw) {
    return cachedSessionOrder;
  }

  cachedSessionOrderRaw = sessionOrderStr;
  cachedSessionOrder = [];

  if (!sessionOrderStr) {
    return cachedSessionOrder;
  }

  try {
    const parsedOrder = JSON.parse(sessionOrderStr);
    cachedSessionOrder = Array.isArray(parsedOrder)
      ? parsedOrder.filter((sessionId): sessionId is string => typeof sessionId === 'string')
      : [];
    debugLog('[SessionGetters] 使用本地存储的用户自定义标签顺序');
  } catch (e) {
    console.error('[SessionGetters] 解析本地存储的标签顺序失败:', e);
    cachedSessionOrder = [];
  }

  return cachedSessionOrder;
};

if (typeof window !== 'undefined') {
  window.addEventListener(SESSION_ORDER_UPDATED_EVENT, () => {
    cachedSessionOrderRaw = null;
  });
}

export const sessionTabs = computed(() => {
  return Array.from(sessions.value.values()).map(session => ({
    sessionId: session.sessionId,
    connectionName: session.connectionName,
  }));
});

// 包含状态的标签页信息
export const sessionTabsWithStatus = computed((): SessionTabInfoWithStatus[] => {
  const sessionOrder = readSessionOrder();
  
  const sessionList = Array.from(sessions.value.values());
  if (sessionOrder.length > 0) {
    const sessionOrderIndexMap = new Map(sessionOrder.map((sessionId, index) => [sessionId, index]));
    // 按照用户自定义顺序排序
    return sessionList
      .sort((a, b) => {
        const indexA = sessionOrderIndexMap.get(a.sessionId);
        const indexB = sessionOrderIndexMap.get(b.sessionId);
        if (indexA === undefined && indexB === undefined) return a.createdAt - b.createdAt;
        if (indexA === undefined) return 1;
        if (indexB === undefined) return -1;
        return indexA - indexB;
      })
      .map(session => ({
        sessionId: session.sessionId,
        connectionName: session.connectionName,
        status: session.wsManager.connectionStatus.value, // 从 wsManager 获取状态
        isMarkedForSuspend: session.isMarkedForSuspend,
      }));
  } else {
    // 如果没有自定义顺序，则按照创建时间排序
    return sessionList
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(session => ({
        sessionId: session.sessionId,
        connectionName: session.connectionName,
        status: session.wsManager.connectionStatus.value, // 从 wsManager 获取状态
        isMarkedForSuspend: session.isMarkedForSuspend,
      }));
  }
});

export const activeSession = computed((): SessionState | null => {
  if (!activeSessionId.value) return null;
  return sessions.value.get(activeSessionId.value) || null;
});

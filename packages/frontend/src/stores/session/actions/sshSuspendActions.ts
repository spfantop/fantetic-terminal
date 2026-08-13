
import { sessions, suspendedSshSessions, isLoadingSuspendedSessions } from '../state';
import type {
  SshMarkForSuspendReqMessage,
  SshUnmarkForSuspendReqMessage,
} from '../../../types/websocket.types'; 
import { useUiNotificationsStore } from '../../uiNotifications.store'; 
import type { SuspendedSshSession } from '../../../types/ssh-suspend.types'; 
import i18n from '../../../i18n'; 
import type { ComposerTranslation } from 'vue-i18n'; 
import apiClient from '../../../utils/apiClient';
import { debugLog } from '../../../composables/useDebugLog';
import { createSingleFlight } from '../../../utils/asyncScheduling';

const t: ComposerTranslation = i18n.global.t; 

const requestSuspendedSshSessions = createSingleFlight(async (): Promise<void> => {
  try {
    const response = await apiClient.get<SuspendedSshSession[]>('ssh-suspend/suspended-sessions');
    suspendedSshSessions.value = response.data;
    debugLog(`[${t('term.sshSuspend')}] 已通过 HTTP 获取挂起列表，数量: ${response.data.length}`);
  } catch (error) {
    console.error(`[${t('term.sshSuspend')}] 通过 HTTP 获取挂起列表失败:`, error);
    useUiNotificationsStore().addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.fetchListError', { error: String(error) }),
    });
  }
});

/**
 * 请求启动 SSH 会话挂起
 * @param sessionId 要挂起的活动会话 ID
 */
export const requestStartSshSuspend = (sessionId: string): void => {
  const session = sessions.value.get(sessionId);
  if (session?.kind === 'ssh' && session.wsManager) {
    if (!session.wsManager.isConnected.value) {
      console.warn(`[${t('term.sshSuspend')}] WebSocket 未连接，无法请求标记挂起 (会话 ID: ${sessionId})。`);
      useUiNotificationsStore().addNotification({ type: 'error', message: t('sshSuspend.notifications.wsNotConnectedError') });
      return;
    }

    let initialBuffer = '';
    if (session.terminalManager && session.terminalManager.terminalInstance && session.terminalManager.terminalInstance.value) {
      const term = session.terminalManager.terminalInstance.value;
      const buffer = term.buffer.active;
      
      let lastNonEmptyLineIndex = -1;
      // 从下往上找到最后一个非空行
      for (let i = buffer.length - 1; i >= 0; i--) {
        const line = buffer.getLine(i);
        // translateToString(true) 会移除行尾空白，再 trim() 判断是否整行都是空白
        if (line && line.translateToString(true).trim() !== '') {
          lastNonEmptyLineIndex = i;
          break;
        }
      }

      if (lastNonEmptyLineIndex !== -1) {
        const lines = [];
        for (let i = 0; i <= lastNonEmptyLineIndex; i++) {
          // 获取行内容，translateToString(true) 会移除行尾空白
          lines.push(buffer.getLine(i)?.translateToString(true) || '');
        }
        initialBuffer = lines.join('\n');
      }
      // join('\n') 会在行间添加换行符，如果最后一行是空字符串，末尾不会有多余的 \n
      // 如果最后一行非空，则自然以该行结束。

    } else {
      console.warn(`[${t('term.sshSuspend')}] 未能获取会话 ${sessionId} 的终端实例以提取初始缓冲区。`);
    }

    const message: SshMarkForSuspendReqMessage = {
      type: 'SSH_MARK_FOR_SUSPEND',
      payload: { sessionId, initialBuffer: initialBuffer || undefined }, // +++ 将 initialBuffer 添加到 payload +++
    };
    session.wsManager.sendMessage(message);
    debugLog(`[${t('term.sshSuspend')}] 已发送 SSH_MARK_FOR_SUSPEND 请求 (会话 ID: ${sessionId}, 包含初始缓冲区: ${!!initialBuffer})`);
    // 前端在发送此请求后，会话应保持活动状态，直到用户关闭标签页或网络断开。
    // 后端会在 WebSocket 关闭时处理实际的挂起。
    // 用户界面上可以给一个提示，表明“此会话已标记，关闭后将尝试挂起”。
    useUiNotificationsStore().addNotification({
      type: 'info',
      message: t('sshSuspend.notifications.markedForSuspendInfo', { id: sessionId.slice(0,8) }),
      timeout: 5000, // +++ 修改：duration -> timeout +++
    });

  } else {
    console.warn(`[${t('term.sshSuspend')}] 未找到会话或 WebSocket 管理器 (会话 ID: ${sessionId})，无法请求标记挂起。`);
    useUiNotificationsStore().addNotification({ type: 'error', message: t('sshSuspend.notifications.sessionNotFoundError') });
  }
};

/**
 * 请求取消标记一个会话为待挂起
 * @param sessionId 要取消标记的活动会话 ID
 */
export const requestUnmarkSshSuspend = (sessionId: string): void => {
  const session = sessions.value.get(sessionId);
  if (session?.kind === 'ssh' && session.wsManager) {
    if (!session.wsManager.isConnected.value) {
      console.warn(`[${t('term.sshSuspend')}] WebSocket 未连接，无法请求取消标记挂起 (会话 ID: ${sessionId})。`);
      useUiNotificationsStore().addNotification({ type: 'error', message: t('sshSuspend.notifications.wsNotConnectedError') });
      return;
    }
    if (!session.isMarkedForSuspend) {
      console.warn(`[${t('term.sshSuspend')}] 会话 ${sessionId} 并未被标记为待挂起，无需取消。`);
      // 可以选择不发送请求或发送一个让后端确认的请求
      // 为保持简单，如果前端状态已经是未标记，则不执行操作或仅给用户提示
      useUiNotificationsStore().addNotification({ type: 'info', message: t('sshSuspend.notifications.notMarkedWarning') });
      return;
    }

    const message: SshUnmarkForSuspendReqMessage = {
      type: 'SSH_UNMARK_FOR_SUSPEND',
      payload: { sessionId },
    };
    session.wsManager.sendMessage(message);
    debugLog(`[${t('term.sshSuspend')}] 已发送 SSH_UNMARK_FOR_SUSPEND 请求 (会话 ID: ${sessionId})`);
  } else {
    console.warn(`[${t('term.sshSuspend')}] 未找到会话或 WebSocket 管理器 (会话 ID: ${sessionId})，无法请求取消标记挂起。`);
    useUiNotificationsStore().addNotification({ type: 'error', message: t('sshSuspend.notifications.sessionNotFoundError') });
  }
};

/**
 * 获取挂起的 SSH 会话列表 (通过 HTTP API)
 */
export const fetchSuspendedSshSessions = async (options?: { showLoadingIndicator?: boolean }): Promise<void> => {
  const shouldShowLoading = options?.showLoadingIndicator ?? true;

  if (shouldShowLoading) {
    isLoadingSuspendedSessions.value = true;
  }
  try {
    await requestSuspendedSshSessions();
  } finally {
    if (shouldShowLoading) {
      isLoadingSuspendedSessions.value = false;
    }
  }
};

/**
 * 请求终止并移除一个活跃的挂起 SSH 会话
 * @param suspendSessionId 要终止并移除的挂起会话 ID
 */
export const terminateAndRemoveSshSession = async (suspendSessionId: string): Promise<void> => {
  debugLog(`[${t('term.sshSuspend')}] 请求通过 HTTP API 终止并移除挂起会话 (ID: ${suspendSessionId})`);
  const uiNotificationsStore = useUiNotificationsStore();
  try {
    // 假设后端 API 返回成功时状态码为 200/204，失败时返回错误信息
    await apiClient.delete(`ssh-suspend/terminate/${suspendSessionId}`);
    debugLog(`[${t('term.sshSuspend')}] HTTP API 终止并移除会话 ${suspendSessionId} 成功。`);

    // 复用或直接实现 handleSshSuspendTerminatedResp 的逻辑
    const index = suspendedSshSessions.value.findIndex(s => s.suspendSessionId === suspendSessionId);
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.terminatedSuccess', { name: removedSession.customSuspendName || removedSession.connectionName }),
      });
    }
  } catch (error: any) {
    console.error(`[${t('term.sshSuspend')}] 通过 HTTP API 终止并移除会话 ${suspendSessionId} 失败:`, error);
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.terminateError', { error: error.response?.data?.message || error.message || t('term.unknownError') }),
    });
  }
};

/**
 * 请求移除一个已断开的挂起 SSH 会话条目
 * @param suspendSessionId 要移除的挂起会话条目 ID
 */
export const removeSshSessionEntry = async (suspendSessionId: string): Promise<void> => {
  debugLog(`[${t('term.sshSuspend')}] 请求通过 HTTP API 移除已断开的挂起条目 (ID: ${suspendSessionId})`);
  const uiNotificationsStore = useUiNotificationsStore();
  try {
    await apiClient.delete(`ssh-suspend/entry/${suspendSessionId}`);
    debugLog(`[${t('term.sshSuspend')}] HTTP API 移除已断开条目 ${suspendSessionId} 成功。`);

    // 复用或直接实现 handleSshSuspendEntryRemovedResp 的逻辑
    const index = suspendedSshSessions.value.findIndex(s => s.suspendSessionId === suspendSessionId);
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.entryRemovedSuccess', { name: removedSession.customSuspendName || removedSession.connectionName }),
      });
    }
  } catch (error: any) {
    console.error(`[${t('term.sshSuspend')}] 通过 HTTP API 移除已断开条目 ${suspendSessionId} 失败:`, error);
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.entryRemovedError', { error: error.response?.data?.message || error.message || t('term.unknownError') }),
    });
  }
};

/**
 * 请求编辑挂起 SSH 会话的自定义名称 (通过 HTTP API)
 * @param suspendSessionId 要编辑的挂起会话 ID
 * @param newCustomName 新的自定义名称
 */
export const editSshSessionName = async (suspendSessionId: string, newCustomName: string): Promise<void> => {
  debugLog(`[${t('term.sshSuspend')}] 请求通过 HTTP API 编辑挂起会话名称 (ID: ${suspendSessionId}, 新名称: "${newCustomName}")`);
  const uiNotificationsStore = useUiNotificationsStore();
  try {
    // 假设后端 API 端点为 /api/ssh-suspend/name/:suspendSessionId
    // 并且它接受一个包含 { customName: string } 的 PUT 请求体
    // 并返回包含 { message: string, customName: string } 的成功响应
    const response = await apiClient.put<{ message: string, customName: string }>(
      `ssh-suspend/name/${suspendSessionId}`,
      { customName: newCustomName }
    );

    debugLog(`[${t('term.sshSuspend')}] HTTP API 编辑名称 ${suspendSessionId} 成功:`, response.data);

    // 更新前端状态
    const session = suspendedSshSessions.value.find(s => s.suspendSessionId === suspendSessionId);
    if (session) {
      session.customSuspendName = response.data.customName; // 使用后端返回的名称确保一致性
      uiNotificationsStore.addNotification({
        type: 'success',
        message: t('sshSuspend.notifications.nameEditedSuccess', { name: response.data.customName }),
      });
    } else {
      // 如果会话在前端列表中找不到了（理论上不应该发生，因为是先找到再编辑的）
      // 也可以选择重新获取列表
      fetchSuspendedSshSessions();
    }
  } catch (error: any) {
    console.error(`[${t('term.sshSuspend')}] 通过 HTTP API 编辑名称 ${suspendSessionId} 失败:`, error);
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.nameEditedError', { error: error.response?.data?.message || error.message || t('term.unknownError') }),
    });
  }
};

/**
 * 请求导出指定挂起 SSH 会话的日志
 * @param suspendSessionId 要导出日志的挂起会话 ID
 */
export const exportSshSessionLog = async (suspendSessionId: string): Promise<void> => {
  const uiNotificationsStore = useUiNotificationsStore();
  debugLog(`[${t('term.sshSuspend')}] 请求导出挂起会话日志 (ID: ${suspendSessionId})`);

  try {
    // API 端点为 /api/v1/ssh-suspend/log/:suspendSessionId
    // apiClient.get会自动处理Blob响应类型，并尝试触发下载
    // 我们需要获取建议的文件名，后端会在 Content-Disposition 头中提供
    const response = await apiClient.get<Blob>(`ssh-suspend/log/${suspendSessionId}`, {
      responseType: 'blob', // 重要：期望响应为 Blob
      // 我们可以传递一个 onDownloadProgress 回调（如果 apiClient 支持的话）
    });

    // 从 Content-Disposition 获取文件名
    const contentDisposition = response.headers['content-disposition'];
    let filename = `ssh_log_${suspendSessionId}.log`; // 默认文件名
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
      if (filenameMatch && filenameMatch.length > 1) {
        filename = filenameMatch[1];
      }
    }

    // 创建一个下载链接并点击它
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename); // 设置下载文件名
    document.body.appendChild(link);
    link.click();

    // 清理
    link.parentNode?.removeChild(link);
    window.URL.revokeObjectURL(url);

    uiNotificationsStore.addNotification({
      type: 'success',
      message: t('sshSuspend.notifications.logExportSuccess', { name: filename }),
    });
    debugLog(`[${t('term.sshSuspend')}] 挂起会话日志 ${filename} (ID: ${suspendSessionId}) 已开始下载。`);

  } catch (error: any) {
    console.error(`[${t('term.sshSuspend')}] 导出挂起会话日志 ${suspendSessionId} 失败:`, error);
    let errorMessage = t('term.unknownError');
    if (error.response && error.response.data) {
      // 如果响应是 Blob 但我们期望 JSON 错误信息，需要特殊处理
      // 假设错误时后端会返回 JSON
      if (error.response.data instanceof Blob && error.response.headers['content-type']?.includes('application/json')) {
        try {
          const errorJson = JSON.parse(await error.response.data.text());
          errorMessage = errorJson.message || errorMessage;
        } catch (e) {
          // Blob 不是有效的 JSON，使用通用错误
        }
      } else if (typeof error.response.data === 'object') {
        errorMessage = error.response.data.message || error.message;
      } else {
        errorMessage = error.message;
      }
    } else {
      errorMessage = error.message || String(error);
    }
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.logExportError', { error: errorMessage }),
    });
  }
};

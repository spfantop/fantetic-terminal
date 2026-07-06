<script setup lang="ts">
import { ref, computed, PropType, onMounted, onBeforeUnmount, watch } from 'vue';
import draggable from 'vuedraggable';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { storeToRefs } from 'pinia';
import WorkspaceConnectionListComponent from './WorkspaceConnectionList.vue';
import TabBarContextMenu from './TabBarContextMenu.vue';
import TransferProgressModal from './TransferProgressModal.vue';
import { useSessionStore } from '../stores/session.store';
import { useConnectionsStore, type ConnectionInfo } from '../stores/connections.store';
import { useLayoutStore } from '../stores/layout.store';
import { SESSION_ORDER_UPDATED_EVENT } from '../stores/session/getters';
import { useWorkspaceEventEmitter, useWorkspaceEventSubscriber, useWorkspaceEventOff } from '../composables/workspaceEvents'; // +++ 导入 useWorkspaceEventOff +++
import { useDraggableDialog } from '../composables/useDraggableDialog';
import { debugLog } from '../composables/useDebugLog';

import type { SessionTabInfoWithStatus } from '../stores/session/types'; // 路径修正


const { t } = useI18n();
const emitWorkspaceEvent = useWorkspaceEventEmitter(); // +++ 获取事件发射器 +++
const onWorkspaceEvent = useWorkspaceEventSubscriber(); // +++ 获取事件订阅器 +++
const offWorkspaceEvent = useWorkspaceEventOff(); // +++ 获取事件取消订阅器 +++
const layoutStore = useLayoutStore(); // 初始化布局 store
const connectionsStore = useConnectionsStore();
const { isHeaderVisible } = storeToRefs(layoutStore); // 从 layout store 获取主导航栏可见状态
const route = useRoute(); // 获取路由实例
const SERVER_PANEL_COLLAPSED_EVENT = 'fantetic:connections-server-panel-collapsed';
const SERVER_PANEL_TOGGLE_EVENT = 'fantetic:connections-server-panel-toggle';

const normalizeRoutePath = (path: string) => path.replace(/\/+$/, '') || '/';

// 定义 Props
const props = defineProps({
  sessions: {
    type: Array as PropType<SessionTabInfoWithStatus[]>,
    required: true,
  },
  activeSessionId: {
    type: String as PropType<string | null>,
    required: false,
    default: null,
  },
  isMobile: {
    type: Boolean,
    default: false,
  },
  splitWorkspaceAvailable: {
    type: Boolean,
    default: false,
  },
  mergeWorkspaceAvailable: {
    type: Boolean,
    default: false,
  },
  workspaceSplitActive: {
    type: Boolean,
    default: false,
  },
  workspacePaneId: {
    type: String as PropType<string | null>,
    default: null,
  },
  showSplitAction: {
    type: Boolean,
    default: true,
  },
  disableSessionDrag: {
    type: Boolean,
    default: false,
  },
  listenWorkspaceConnectionEvents: {
    type: Boolean,
    default: true,
  },
  showLayoutActions: {
    type: Boolean,
    default: true,
  },
  batchTerminalInputActive: {
    type: Boolean,
    default: false,
  },
  batchTerminalInputAvailable: {
    type: Boolean,
    default: false,
  },
});

// 定义事件 (保留 update:sessions 用于 v-model)
const emit = defineEmits<{
  (e: 'update:sessions', newSessions: SessionTabInfoWithStatus[]): void;
  (e: 'toggle-batch-terminal-input'): void;
}>();


const activateSession = (sessionId: string) => {
  if (sessionId !== props.activeSessionId) {
    emitWorkspaceEvent('session:activate', { sessionId });
  }
};

const closeSession = (event: MouseEvent, sessionId: string) => {
  event.stopPropagation(); // 阻止事件冒泡到标签点击事件
  emitWorkspaceEvent('session:close', { sessionId });
};

// --- 本地状态 ---
const sessionStore = useSessionStore(); // Session store 保持不变
const showConnectionListPopup = ref(false); // 连接列表弹出状态
const connectionListPopupRootRef = ref<HTMLElement | null>(null);
const connectionListPopupContentRef = ref<HTMLElement | null>(null);
const { centerDialog: centerConnectionListPopup, startDialogDrag: startConnectionListPopupDrag } = useDraggableDialog({
  rootRef: connectionListPopupRootRef,
  dialogRef: connectionListPopupContentRef,
});
const draggableSessions = ref<SessionTabInfoWithStatus[]>([]); // + Local state for draggable
const showTransferProgressModal = ref(false); // 控制传输进度模态框的显示状态
const isConnectionsRoute = ref(normalizeRoutePath(route.path) === '/connections');
const isConnectionsServerPanelCollapsed = ref(false);

const sessionsSyncKey = computed(() => (
  props.sessions
    .map(session => `${session.sessionId}:${session.connectionName}:${session.status}:${session.isMarkedForSuspend ? 1 : 0}`)
    .join('|')
));

// 只跟踪标签栏实际展示和排序需要的字段，避免终端状态更新触发深度遍历。
watch(sessionsSyncKey, () => {
  draggableSessions.value = [...props.sessions];
}, { immediate: true });

// +++ 右键菜单状态 +++
const contextMenuVisible = ref(false);
const contextMenuPosition = ref({ x: 0, y: 0 });
const contextTargetSessionId = ref<string | null>(null); // Keep for logic inside this component if needed elsewhere
const menuTargetId = ref<string | null>(null); // + Ref specifically for passing to the menu prop

const togglePopup = () => {
  showConnectionListPopup.value = !showConnectionListPopup.value;
  if (showConnectionListPopup.value) {
    centerConnectionListPopup();
  }
};

// 处理从弹出列表中选择连接的事件
const handlePopupConnect = (connectionId: number) => {
  debugLog(`[TabBar] Popup connect request for ID: ${connectionId}`);
  const connectionInfo = connectionsStore.connections.find(c => c.id === connectionId);
  if (!connectionInfo) {
    console.error(`[TabBar] handlePopupConnect: 未找到 ID 为 ${connectionId} 的连接信息。`);
    showConnectionListPopup.value = false; // 关闭弹出窗口
    return;
  }

  debugLog(`[TabBar] Popup connect request for ID: ${connectionId}. Calling sessionStore.handleConnectRequest.`);
  sessionStore.handleConnectRequest(connectionInfo);
  showConnectionListPopup.value = false; // 关闭弹出窗口
};

// 处理从弹窗内部发出的添加连接请求
const handleRequestAddFromPopup = () => {
  debugLog('[TabBar] Received request-add-connection from popup component.');
  showConnectionListPopup.value = false; // 关闭弹窗
  emitWorkspaceEvent('connection:requestAdd'); // 向上发出事件
};

// 处理从弹窗内部发出的编辑连接请求
const handleRequestEditFromPopup = (connection: ConnectionInfo) => { // 假设 WorkspaceConnectionList 传递了连接对象
  debugLog('[TabBar] Received request-edit-connection from popup component for connection:', connection);
  showConnectionListPopup.value = false; // 关闭弹窗
  // 向上发出事件，并携带连接信息
  emitWorkspaceEvent('connection:requestEdit', { connectionInfo: connection });
};

const handleWorkspaceConnectionConnect = (payload: { connectionId: number }) => {
  debugLog('[TabBar] Received connection:connect event:', payload);
  handlePopupConnect(payload.connectionId);
};

const handleOpenTransferProgressModal = () => {
  debugLog('[TabBar] Received ui:openTransferProgressModal event, opening modal.');
  if (layoutStore.usedPanes.has('transferProgress')) {
    return;
  }
  showTransferProgressModal.value = true;
};

// --- 移除 handleRequestRdpFromPopup 方法 ---
// const handleRequestRdpFromPopup = (connection: ConnectionInfo) => { ... };

// +++ 右键菜单方法 +++
const showContextMenu = (event: MouseEvent, sessionId: string) => {
  event.preventDefault();
  event.stopPropagation();
  contextTargetSessionId.value = sessionId; // Still set the original ref if needed elsewhere
  menuTargetId.value = sessionId; // + Set the dedicated ref for the prop
  contextMenuPosition.value = { x: event.clientX, y: event.clientY };
  contextMenuVisible.value = true;
  // 添加全局监听器以关闭菜单
  document.addEventListener('click', closeContextMenuOnClickOutside, { capture: true, once: true });
};

const closeContextMenu = () => {
  contextMenuVisible.value = false;
  contextTargetSessionId.value = null; // Clear original ref if needed
  // menuTargetId.value = null; // -- REMOVE THIS LINE -- Let the value persist until next show
  // 移除监听器（如果它仍然存在）
  document.removeEventListener('click', closeContextMenuOnClickOutside, { capture: true });
};

// 用于全局点击监听器的函数
const closeContextMenuOnClickOutside = (event: MouseEvent) => {
    if ((event.target as HTMLElement | null)?.closest('.tab-bar-context-menu')) {
      return;
    }
    closeContextMenu();
};


// + Update function signature to receive payload
const handleContextMenuAction = (payload: { action: string; targetId: string | number | null }) => {
  const { action, targetId } = payload;
  // const targetId = contextTargetSessionId.value; // No longer needed
  if (!targetId || typeof targetId !== 'string') { // Ensure targetId is a string (session ID)
      console.warn('[TabBar] handleContextMenuAction called but targetId is null or not a string.');
      return;
  }

  switch (action) {
    case 'pop-out':
      emitWorkspaceEvent('session:popOut', {
        sessionId: targetId,
        windowRef: window.open('', `fantetic-terminal-${targetId}`, 'popup=yes,width=1200,height=800'),
      });
      break;
    case 'fullscreen':
      emitWorkspaceEvent('session:fullscreen', { sessionId: targetId });
      break;
    case 'close':
      emitWorkspaceEvent('session:close', { sessionId: targetId });
      break;
    case 'close-others':
      emitWorkspaceEvent('session:closeOthers', { targetSessionId: targetId });
      break;
    case 'close-right':
      emitWorkspaceEvent('session:closeToRight', { targetSessionId: targetId });
      break;
    case 'close-left':
      // 注意：关闭左侧通常不包括当前标签本身
      emitWorkspaceEvent('session:closeToLeft', { targetSessionId: targetId });
      break;
    case 'mark-for-suspend': // +++ 修改 action 名称 +++
      if (typeof targetId === 'string') {
        debugLog(`[TabBar] Context menu action 'mark-for-suspend' requested for session ID: ${targetId}`);
        sessionStore.requestStartSshSuspend(targetId); // 这个 action 现在是标记
      } else {
        console.warn(`[TabBar] 'mark-for-suspend' action called with invalid targetId:`, targetId);
      }
      break;
    case 'unmark-for-suspend': 
      if (typeof targetId === 'string') {
        debugLog(`[TabBar] Context menu action 'unmark-for-suspend' requested for session ID: ${targetId}`);
        sessionStore.requestUnmarkSshSuspend(targetId);
      } else {
        console.warn(`[TabBar] 'unmark-for-suspend' action called with invalid targetId:`, targetId);
      }
      break;
    default:
      console.warn(`[TabBar] Unknown context menu action: ${action}`);
  }
  // closeContextMenu(); // TabBarContextMenu 内部点击后会触发 close 事件
};

// 计算右键菜单项
const contextMenuItems = computed(() => {
  const items = [];
  const targetSessionIdValue = contextTargetSessionId.value; // 使用局部变量以避免多次访问 .value
  if (!targetSessionIdValue) return [];

  const targetSessionState = sessionStore.sessions.get(targetSessionIdValue);
  if (!targetSessionState) return []; // 如果找不到会话状态，则不显示菜单

  const connectionIdNum = parseInt(targetSessionState.connectionId, 10);
  const connectionInfo = connectionsStore.connections.find(c => c.id === connectionIdNum);

  const currentIndex = props.sessions.findIndex(s => s.sessionId === targetSessionIdValue);
  const totalTabs = props.sessions.length;

  items.push({ label: 'tabs.contextMenu.popOut', action: 'pop-out' });
  items.push({ label: 'tabs.contextMenu.fullscreen', action: 'fullscreen' });

  // 添加标记/取消标记挂起会话菜单项（如果适用）
  if (targetSessionState.kind === 'ssh' && connectionInfo && connectionInfo.type === 'SSH') {
    const isActiveSession = targetSessionState.wsManager.isConnected.value;
    if (isActiveSession) { // 只对活动的SSH会话显示相关操作
      if (targetSessionState.isMarkedForSuspend) {
        items.push({ label: 'tabs.contextMenu.unmarkForSuspend', action: 'unmark-for-suspend' });
      } else {
        // 当未标记时，显示原来的“挂起”文本，但 action 触发新的标记流程
        items.push({ label: 'tabs.contextMenu.suspendSession', action: 'mark-for-suspend' });
      }
      items.push({ label: '', action: '', isSeparator: true }); // 分隔符
    }
  }

  items.push({ label: 'tabs.contextMenu.close', action: 'close' });

  if (totalTabs > 1) {
    items.push({ label: 'tabs.contextMenu.closeOthers', action: 'close-others' });
  }

  if (currentIndex < totalTabs - 1 && totalTabs > 1) { // 仅当有右侧标签时显示
    items.push({ label: 'tabs.contextMenu.closeRight', action: 'close-right' });
  }

  if (currentIndex > 0 && totalTabs > 1) { // 仅当有左侧标签时显示
    items.push({ label: 'tabs.contextMenu.closeLeft', action: 'close-left' });
  }
  
  // 移除末尾可能存在的分隔符（如果它是最后一项）
  // 确保在 pop 之前检查 items[items.length - 1] 是否真的存在并且是分隔符
  if (items.length > 0) {
    const lastItem = items[items.length - 1];
    if (lastItem && lastItem.isSeparator) {
        items.pop();
    }
  }

  return items;
});


// 处理打开布局配置器的事件
const openLayoutConfigurator = () => {
  debugLog('[TabBar] Emitting open-layout-configurator event');
  emitWorkspaceEvent('ui:openLayoutConfigurator'); // 发出事件
};

// --- Header Visibility Logic ---
const isWorkspaceRoute = ref(normalizeRoutePath(route.path) === '/workspace'); // 检查是否在 /workspace 路由

// 监视路由变化
watch(() => route.path, (newPath) => {
  const normalizedPath = normalizeRoutePath(newPath);
  isWorkspaceRoute.value = normalizedPath === '/workspace';
  isConnectionsRoute.value = normalizedPath === '/connections';
  if (isWorkspaceRoute.value) {
    // 进入 /workspace 时，不需要在这里加载 Header 状态，App.vue 会处理
    debugLog('[TabBar] Entered /workspace route. Header toggle button is now active.');
  }
});

// 组件挂载时检查一次
onMounted(() => {
  const normalizedPath = normalizeRoutePath(route.path);
  isWorkspaceRoute.value = normalizedPath === '/workspace';
  isConnectionsRoute.value = normalizedPath === '/connections';
  if (isWorkspaceRoute.value) {
    // 初始加载时，不需要在这里加载 Header 状态，App.vue 会处理
    debugLog('[TabBar] Mounted on /workspace route. Header toggle button is now active.');
  }
  window.addEventListener(SERVER_PANEL_COLLAPSED_EVENT, handleServerPanelCollapsedEvent);
  if (props.listenWorkspaceConnectionEvents) {
    onWorkspaceEvent('connection:connect', handleWorkspaceConnectionConnect);
  }
  onWorkspaceEvent('ui:openTransferProgressModal', handleOpenTransferProgressModal);
});

// +++ 组件卸载前移除全局监听器 +++
// onBeforeUnmount is imported now
onBeforeUnmount(() => {
    document.removeEventListener('click', closeContextMenuOnClickOutside, { capture: true });
    window.removeEventListener(SERVER_PANEL_COLLAPSED_EVENT, handleServerPanelCollapsedEvent);
    if (props.listenWorkspaceConnectionEvents) {
      offWorkspaceEvent('connection:connect', handleWorkspaceConnectionConnect);
    }
    offWorkspaceEvent('ui:openTransferProgressModal', handleOpenTransferProgressModal);
});


// 切换主导航栏可见性 (只在 workspace 路由下生效)
// + Handler for when draggable updates the model
const handleSessionsUpdate = (newSessions: SessionTabInfoWithStatus[]) => {
  // v-model handles updating draggableSessions.value automatically
  emit('update:sessions', newSessions);
  // 保存用户自定义顺序到本地存储
  const sessionOrder = newSessions.map(session => session.sessionId);
  localStorage.setItem('sessionOrder', JSON.stringify(sessionOrder));
  window.dispatchEvent(new Event(SESSION_ORDER_UPDATED_EVENT));
  debugLog('[TabBar] 已保存用户自定义标签顺序到本地存储');
};
const toggleHeader = () => {
  if (isWorkspaceRoute.value) {
    debugLog('[TabBar] Toggling header visibility');
    // 调用 store action
    layoutStore.toggleHeaderVisibility();
  } else {
    debugLog('[TabBar] Not on /workspace route, toggle ignored.');
  }
};

const handleServerPanelCollapsedEvent = (event: Event) => {
  const detail = (event as CustomEvent<{ collapsed?: boolean }>).detail;
  isConnectionsServerPanelCollapsed.value = !!detail?.collapsed;
};

const toggleConnectionsServerPanel = () => {
  window.dispatchEvent(new CustomEvent(SERVER_PANEL_TOGGLE_EVENT));
};

const toggleWorkspaceSplit = () => {
  if (!props.showSplitAction || (!props.splitWorkspaceAvailable && !props.mergeWorkspaceAvailable)) return;
  emitWorkspaceEvent('ui:toggleWorkspaceSplit', { paneId: props.workspacePaneId });
};

const activeSessionState = computed(() => (
  props.activeSessionId ? sessionStore.sessions.get(props.activeSessionId) ?? null : null
));

const shouldShowSingleLineOutputToggle = computed(() => activeSessionState.value?.kind === 'ssh');

const isActiveSessionSingleLineOutput = computed(() => (
  shouldShowSingleLineOutputToggle.value && !!activeSessionState.value?.terminalSingleLineOutput
));

const singleLineOutputToggleIconClass = computed(() => (
  isActiveSessionSingleLineOutput.value ? 'fas fa-arrows-alt-h' : 'fas fa-align-left'
));

const releaseButtonFocus = (event?: Event) => {
  const target = event?.currentTarget;
  if (target instanceof HTMLElement) {
    target.blur();
  }
};

const toggleSingleLineOutput = (event?: MouseEvent) => {
  releaseButtonFocus(event);
  if (!props.activeSessionId || !shouldShowSingleLineOutputToggle.value) return;
  sessionStore.toggleTerminalSingleLineOutput(props.activeSessionId);
};

const shouldShowBatchTerminalInputToggle = computed(() => (
  shouldShowSingleLineOutputToggle.value && !props.isMobile
));

const batchTerminalInputToggleTitle = computed(() => {
  if (!props.batchTerminalInputAvailable) {
    return t('terminalTabBar.batchInputUnavailableTooltip', '分屏中至少需要两个 SSH 终端才能批量执行命令');
  }
  return props.batchTerminalInputActive
    ? t('terminalTabBar.batchInputDisableTooltip', '关闭批量执行命令')
    : t('terminalTabBar.batchInputEnableTooltip', '批量执行命令');
});

const toggleBatchTerminalInput = (event?: MouseEvent) => {
  releaseButtonFocus(event);
  if (!props.batchTerminalInputAvailable) return;
  emit('toggle-batch-terminal-input');
};

const workspaceSplitTitle = computed(() => (
  props.workspaceSplitActive
    ? t('terminalTabBar.mergeWorkspaceTooltip', '合并窗口')
    : t('terminalTabBar.splitWorkspaceTooltip', '窗口分割')
));

const workspaceSplitIconClass = computed(() => (
  props.workspaceSplitActive ? 'fas fa-compress-alt' : 'fas fa-columns'
));

const isWorkspaceSplitButtonEnabled = computed(() => (
  props.showSplitAction && (props.splitWorkspaceAvailable || props.mergeWorkspaceAvailable)
));

const serverPanelToggleIconClass = computed(() => (
  isConnectionsServerPanelCollapsed.value ? 'fas fa-indent' : 'fas fa-outdent'
));

const serverPanelToggleTitle = computed(() => (
  isConnectionsServerPanelCollapsed.value
    ? t('connections.folders.expandPanel', '展开侧边栏')
    : t('connections.folders.collapsePanel', '收起侧边栏')
));

// 计算属性，用于确定眼睛图标的类
const eyeIconClass = computed(() => {
  // 默认显示眼睛图标，如果主导航栏不可见，则显示斜杠眼睛
  // 注意：这里假设 isHeaderVisible 为 true 时是可见的
  return isHeaderVisible.value ? 'fas fa-eye' : 'fas fa-eye-slash';
});

// 计算属性，用于按钮的 title
const toggleButtonTitle = computed(() => {
  // 调整 i18n key 和默认文本
  return isHeaderVisible.value ? t('header.hide', '隐藏导航栏') : t('header.show', '显示导航栏');
});

// + Handler to hide the default drag image
const handleDragStart = (event: DragEvent) => {
  if (event.dataTransfer) {
    // Use a 1x1 transparent pixel as the drag image to hide the default ghost
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    event.dataTransfer.setDragImage(img, 0, 0);
  }
};

// 处理长按事件以在手机模式下触发挂起和取消挂起
let touchTimeout: number | null = null;
const touchDuration = 800; // 长按时间阈值，单位毫秒
let touchedSessionId: string | null = null;

const handleTouchStart = (event: TouchEvent, sessionId: string) => {
  if (props.isMobile) {
    touchedSessionId = sessionId;
    if (touchTimeout) {
      clearTimeout(touchTimeout);
    }
    touchTimeout = window.setTimeout(() => {
      if (touchedSessionId === sessionId) {
        const sessionState = sessionStore.sessions.get(sessionId);
        if (sessionState?.kind !== 'ssh') {
          return;
        }
        if (sessionState.isMarkedForSuspend) {
          debugLog(`[TabBar] Long press to unmark suspend for session ID: ${sessionId}`);
          sessionStore.requestUnmarkSshSuspend(sessionId);
        } else {
          debugLog(`[TabBar] Long press to mark suspend for session ID: ${sessionId}`);
          sessionStore.requestStartSshSuspend(sessionId);
        }
      }
      touchTimeout = null;
    }, touchDuration);
  }
};

const handleTouchEnd = (event: TouchEvent) => {
  if (touchTimeout) {
    clearTimeout(touchTimeout);
    touchTimeout = null;
  }
  touchedSessionId = null;
};
 // 处理鼠标滚轮事件以支持水平滚动
const handleWheel: EventListener = (event: Event) => {
  const wheelEvent = event as WheelEvent;
  const container = wheelEvent.currentTarget as HTMLElement;
  if (container) {
    // 根据滚轮方向调整水平滚动位置
    container.scrollLeft += wheelEvent.deltaY > 0 ? 50 : -50;
    wheelEvent.preventDefault(); // 阻止默认的垂直滚动
  }
};

// 在组件挂载时添加滚轮事件监听
onMounted(() => {
  const tabContainer = document.querySelector('.overflow-x-auto');
  if (tabContainer) {
    tabContainer.addEventListener('wheel', handleWheel as EventListener, { passive: false });
  }
});

// 在组件卸载时移除滚轮事件监听
onBeforeUnmount(() => {
  const tabContainer = document.querySelector('.overflow-x-auto');
  if (tabContainer) {
    tabContainer.removeEventListener('wheel', handleWheel as EventListener);
  }
});

</script>

<template>
  <!-- +++ 使用 :class 绑定来条件化样式，包括高度 (修正 props 引用) +++ -->
  <div :class="['terminal-tab-bar flex bg-header border border-border overflow-hidden',
               { 'rounded-t-md mx-2 mt-2': !props.isMobile && !isConnectionsRoute }, // Desktop margins/rounding - Use props.isMobile
               { 'border-t-0 border-l-0 border-r-0 rounded-none': isConnectionsRoute && !props.isMobile },
               props.isMobile ? 'h-8' : 'h-10' // Mobile height h-8, Desktop h-10 - Use props.isMobile
              ]">
    <button
      v-if="isConnectionsRoute"
      class="flex items-center justify-center px-3 h-full border-r border-border text-text-secondary hover:bg-border hover:text-foreground transition-colors duration-150 flex-shrink-0"
      @click="toggleConnectionsServerPanel"
      :title="serverPanelToggleTitle"
    >
      <i :class="[serverPanelToggleIconClass, 'text-sm']"></i>
    </button>
    <button
      v-if="isConnectionsRoute && !props.isMobile && props.showSplitAction"
      class="flex items-center justify-center px-3 h-full border-r border-border text-text-secondary transition-colors duration-150 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
      :class="isWorkspaceSplitButtonEnabled ? 'hover:bg-border hover:text-foreground' : ''"
      @click="toggleWorkspaceSplit"
      :disabled="!isWorkspaceSplitButtonEnabled"
      :aria-disabled="!isWorkspaceSplitButtonEnabled"
      :title="workspaceSplitTitle"
    >
      <i :class="[workspaceSplitIconClass, 'text-sm']"></i>
    </button>
    <div class="flex items-center overflow-x-auto flex-shrink min-w-0 h-full"> <!-- Ensure inner div has h-full -->
      <draggable
        v-model="draggableSessions"
        item-key="sessionId"
        tag="ul"
        class="flex list-none p-0 m-0 h-full flex-shrink-0"
        @update:modelValue="handleSessionsUpdate"
        ghost-class="opacity-50"
        drag-class="opacity-75"
        animation="150"
        :disabled="props.isMobile || props.disableSessionDrag"
      >
        <template #item="{ element: session }">
          <li
            :key="session.sessionId"
            :class="['flex items-center px-3 h-full cursor-pointer border-r border-border transition-colors duration-150 relative group',
                     session.sessionId === activeSessionId ? 'bg-background text-foreground' : 'bg-header text-text-secondary hover:bg-border']"
            @click="activateSession(session.sessionId)"
            @contextmenu.prevent="showContextMenu($event, session.sessionId)"
            @touchstart="handleTouchStart($event, session.sessionId)"
            @touchend="handleTouchEnd($event)"
            @dragstart="handleDragStart"
            :title="session.connectionName"
        >
          <!-- Status dot -->
          <span :class="['w-2 h-2 rounded-full mr-2 flex-shrink-0',
                         session.isMarkedForSuspend ? 'bg-blue-500' : // +++ 如果已标记待挂起，则为蓝色 +++
                         session.status === 'connected' ? 'bg-green-500' :
                         session.status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                         session.status === 'disconnected' ? 'bg-red-500' : 'bg-gray-400']"></span>
          <span class="truncate text-sm" style="transform: translateY(-1px);">{{ session.connectionName }}</span>
          <button class="ml-2 p-0.5 rounded-full text-text-secondary hover:bg-border hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                  :class="{'text-foreground hover:bg-header': session.sessionId === activeSessionId}"
                  @click="closeSession($event, session.sessionId)" :title="$t('tabs.closeTabTooltip')">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            </button>
          </li>
        </template>
      </draggable>
      <!-- Add Tab Button -->
      <button class="flex items-center justify-center px-3 h-full border-border text-text-secondary hover:bg-border hover:text-foreground transition-colors duration-150 flex-shrink-0"
              @click="togglePopup" :title="$t('tabs.newTabTooltip')">
        <i class="fas fa-plus text-sm"></i>
      </button>
    </div>
    <!-- Action Buttons -->
    <div class="flex items-center ml-auto h-full flex-shrink-0">
        <button
          v-if="isWorkspaceRoute"
          class="flex items-center justify-center px-3 h-full border-l border-border text-text-secondary hover:bg-border hover:text-foreground transition-colors duration-150"
          @click="toggleHeader"
          :title="toggleButtonTitle"
        >
          <i :class="[eyeIconClass, 'text-sm']"></i>
        </button>
        <button
          v-if="shouldShowSingleLineOutputToggle"
          type="button"
          class="flex items-center justify-center px-3 h-full border-l border-border transition-colors duration-150"
          :class="isActiveSessionSingleLineOutput ? 'bg-primary/10 text-primary hover:bg-primary/15' : 'text-text-secondary hover:bg-border hover:text-foreground'"
          :aria-pressed="isActiveSessionSingleLineOutput"
          :title="isActiveSessionSingleLineOutput ? t('terminalTabBar.multiLineOutputTooltip', '切换为多行输出') : t('terminalTabBar.singleLineOutputTooltip', '切换为单行输出')"
          @pointerdown.prevent
          @click="toggleSingleLineOutput"
        >
          <i :class="[singleLineOutputToggleIconClass, 'text-sm']"></i>
        </button>
        <button
          v-if="shouldShowBatchTerminalInputToggle"
          type="button"
          class="flex items-center justify-center px-3 h-full border-l border-border transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
          :class="props.batchTerminalInputActive ? 'bg-primary/10 text-primary hover:bg-primary/15' : 'text-text-secondary hover:bg-border hover:text-foreground'"
          :disabled="!props.batchTerminalInputAvailable"
          :aria-disabled="!props.batchTerminalInputAvailable"
          :aria-pressed="props.batchTerminalInputActive"
          :title="batchTerminalInputToggleTitle"
          @pointerdown.prevent
          @click="toggleBatchTerminalInput"
        >
          <i class="fas fa-keyboard text-sm"></i>
        </button>
        <!-- +++ 使用 v-if 隐藏移动端的布局按钮 +++ -->
        <button v-if="!isMobile && props.showLayoutActions" class="flex items-center justify-center px-3 h-full border-l border-border text-text-secondary hover:bg-border hover:text-foreground transition-colors duration-150"
                @click="openLayoutConfigurator" :title="t('layout.configure', '配置布局')">
          <i class="fas fa-th-large text-sm"></i>
        </button>
    </div>
    <!-- Connection List Popup -->
    <div ref="connectionListPopupRootRef" v-if="showConnectionListPopup" class="fixed inset-0 bg-overlay flex justify-center items-center z-50 p-4" @click.self="togglePopup">
      <div ref="connectionListPopupContentRef" class="bg-background text-foreground p-6 rounded-lg shadow-xl border border-border w-full max-w-2xl max-h-[80vh] flex flex-col relative">
        <button class="absolute top-2 right-2 p-1 text-text-secondary hover:text-foreground" @pointerdown.stop @click="togglePopup">
           <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
             <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
           </svg>
        </button>
        <h3 class="text-lg font-semibold text-center mb-4 cursor-move select-none" @pointerdown="startConnectionListPopupDrag">{{ t('terminalTabBar.selectServerTitle') }}</h3>
        <div class="flex-grow overflow-y-auto border border-border rounded">
            <WorkspaceConnectionListComponent
              @connect-request="handlePopupConnect"
              @open-new-session="handlePopupConnect"
              @request-add-connection="handleRequestAddFromPopup"
              @request-edit-connection="handleRequestEditFromPopup"
              class="popup-connection-list"
              folder-mode
            />
        </div>
      </div>
    </div>
    <!-- +++ Context Menu Instance (Ensure it's present) +++ -->
    <TabBarContextMenu
      :visible="contextMenuVisible"
      :position="contextMenuPosition"
      :items="contextMenuItems"
      :target-id="menuTargetId"
      @menu-action="handleContextMenuAction"
      @close="closeContextMenu"
    />
    <!-- 传输进度模态框 -->
    <TransferProgressModal v-model:visible="showTransferProgressModal" />
  </div>
</template>

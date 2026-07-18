<script setup lang="ts">
import { createApp, getCurrentInstance, nextTick, onMounted, onBeforeUnmount, computed, ref, shallowRef, watch, h, type App as VueApp, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useLayoutStore, type LayoutNode } from '../stores/layout.store'; // +++ Import LayoutNode +++
import { useDeviceDetection } from '../composables/useDeviceDetection';
import { useConnectionsStore, type ConnectionInfo } from '../stores/connections.store';
import AddConnectionFormComponent from '../components/AddConnectionForm.vue';
import TerminalTabBar from '../components/TerminalTabBar.vue';
import LayoutRenderer from '../components/LayoutRenderer.vue';
import LayoutConfigurator from '../components/LayoutConfigurator.vue';
import FileEditorOverlay from '../components/FileEditorOverlay.vue';
import UINotificationDisplay from '../components/UINotificationDisplay.vue';
import ConfirmDialog from '../components/common/ConfirmDialog.vue';
import FileManager from '../components/FileManager.vue'; 
import { useSessionStore } from '../stores/session.store';
import type { SessionTabInfoWithStatus, SshTerminalInstance } from '../stores/session/types';
import { useSettingsStore } from '../stores/settings.store';
import { useFileEditorStore, type FileTab } from '../stores/fileEditor.store';
import { useCommandHistoryStore } from '../stores/commandHistory.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import { useDialogStore } from '../stores/dialog.store';
import i18n from '../i18n';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import {
  createWorkspaceEventSubscriptionRegistry,
  type WorkspaceEventPayloads
} from '../composables/workspaceEvents';
import type { WebSocketDependencies } from '../composables/useSftpActions'; 
import { useDraggableDialog } from '../composables/useDraggableDialog';
import { debugLog, debugLogLazy } from '../composables/useDebugLog';
import { resolveTerminalBatchInputTargetIds } from '../utils/terminalBatchInput';
import {
  resolveVisibleActiveSessionId,
  resolveWorkspaceLayoutActiveSessionId,
} from '../utils/workspaceVisibleSessions';

// --- Setup ---
const { t } = useI18n();
const appContext = getCurrentInstance()?.appContext;
const sessionStore = useSessionStore();
const settingsStore = useSettingsStore(); // Keep settingsStore instance
const fileEditorStore = useFileEditorStore();
const layoutStore = useLayoutStore();
const commandHistoryStore = useCommandHistoryStore();
const connectionsStore = useConnectionsStore(); 
const uiNotificationsStore = useUiNotificationsStore();
const dialogStore = useDialogStore();
const { isHeaderVisible } = storeToRefs(layoutStore);
const { isMobile } = useDeviceDetection();

// --- 从 Store 获取响应式状态和 Getters ---
const { sessionTabsWithStatus, activeSessionId, activeSession, poppedOutSessionIds } = storeToRefs(sessionStore);
const { shareFileEditorTabsBoolean, layoutLockedBoolean } = storeToRefs(settingsStore); // +++ Add layoutLockedBoolean +++
const { orderedTabs: globalEditorTabs, activeTabId: globalActiveEditorTabId } = storeToRefs(fileEditorStore);
const { layoutTree } = storeToRefs(layoutStore); // 只获取布局树

const sessionOnlyLayoutNode = computed((): LayoutNode => ({
  id: 'rdp-main-terminal-pane',
  type: 'pane',
  component: 'terminal',
  size: 100,
}));

const getEditorTabsForSession = (sessionId: string | null): FileTab[] => {
  if (shareFileEditorTabsBoolean.value) {
    return globalEditorTabs.value;
  }
  if (!sessionId) return [];
  const session = sessionStore.sessions.get(sessionId);
  return session?.kind === 'ssh' ? session.editorTabs.value : [];
};

const getActiveEditorTabIdForSession = (sessionId: string | null) => {
  if (shareFileEditorTabsBoolean.value) {
    return globalActiveEditorTabId.value;
  }
  if (!sessionId) return null;
  const session = sessionStore.sessions.get(sessionId);
  return session?.kind === 'ssh' ? session.activeEditorTabId.value : null;
};

// --- 计算属性 (用于动态绑定编辑器 Props) ---
// 这些计算属性现在需要传递给 LayoutRenderer
const editorTabs = computed((): FileTab[] => { // Ensure return type is FileTab[]
  return getEditorTabsForSession(visibleActiveSessionId.value);
});

const activeEditorTabId = computed(() => {
  return getActiveEditorTabIdForSession(visibleActiveSessionId.value);
});

const poppedOutSessionIdSet = computed(() => new Set(poppedOutSessionIds.value));
const isSessionPopoutActive = computed(() => poppedOutSessionIds.value.length > 0);
const visibleSessionTabsWithStatus = computed(() => (
  sessionTabsWithStatus.value.filter(tab => !poppedOutSessionIdSet.value.has(tab.sessionId))
));
const visibleSessionIds = computed(() => visibleSessionTabsWithStatus.value.map(tab => tab.sessionId));
const visibleActiveSessionId = computed(() => resolveVisibleActiveSessionId({
  activeSessionId: activeSessionId.value,
  visibleSessionIds: visibleSessionIds.value,
}));
const visibleActiveSession = computed(() => (
  visibleActiveSessionId.value ? sessionStore.sessions.get(visibleActiveSessionId.value) ?? null : null
));
const isRemoteDesktopSessionKind = (kind?: string) => kind === 'rdp' || kind === 'vnc';
const isTerminalShellSessionKind = (kind?: string) => kind === 'ssh' || kind === 'telnet';
const isVisibleActiveSessionRemoteDesktop = computed(() => isRemoteDesktopSessionKind(visibleActiveSession.value?.kind));
const fullscreenSessionId = ref<string | null>(null);
const isSessionFullscreenActive = computed(() => fullscreenSessionId.value !== null);
const lastVisibleLayoutActiveSessionId = ref<string | null>(null);
const layoutActiveSessionId = computed(() => resolveWorkspaceLayoutActiveSessionId({
  activeSessionId: activeSessionId.value,
  visibleSessionIds: visibleSessionIds.value,
  previousLayoutActiveSessionId: lastVisibleLayoutActiveSessionId.value,
  fullscreenSessionId: fullscreenSessionId.value,
}));
const isTerminalOnlyMode = computed(() => isVisibleActiveSessionRemoteDesktop.value || isSessionFullscreenActive.value);
const FULLSCREEN_ESC_PRESS_THRESHOLD = 3;
const FULLSCREEN_ESC_SEQUENCE_TIMEOUT_MS = 1200;
const fullscreenEscPressCount = ref(0);
let fullscreenEscResetTimer: number | null = null;

let cachedTerminalInputSessionId = '';
let cachedTerminalInputSession: ReturnType<typeof sessionStore.sessions.get> | null = null;
let cachedTerminalInputManager: SshTerminalInstance | null = null;

const refreshTerminalInputCache = (sessionId: string) => {
  const session = sessionStore.sessions.get(sessionId) ?? null;
  const manager = isTerminalShellSessionKind(session?.kind)
    ? (session.terminalManager as SshTerminalInstance | undefined) ?? null
    : null;
  if (
    sessionId === cachedTerminalInputSessionId &&
    session === cachedTerminalInputSession &&
    manager === cachedTerminalInputManager
  ) return;

  cachedTerminalInputSessionId = sessionId;
  cachedTerminalInputSession = session;
  cachedTerminalInputManager = manager;
};

const readTerminalInputManager = (sessionId: string) => {
  refreshTerminalInputCache(sessionId);
  return cachedTerminalInputManager;
};

const readTerminalInputSession = (sessionId: string) => {
  refreshTerminalInputCache(sessionId);
  return cachedTerminalInputSession;
};

const getSshSessionForAction = (sessionId?: string) => {
  const session = sessionId ? sessionStore.sessions.get(sessionId) ?? null : activeSession.value ?? null;
  return isTerminalShellSessionKind(session?.kind) ? session : null;
};

const workspaceSplitAvailable = computed(() => !isMobile.value && visibleSessionTabsWithStatus.value.length > 1);
const isWorkspaceSplitActive = ref(false);
const workspaceTabOrder = ref<string[]>([]);
const isBatchTerminalInputActive = ref(false);

const mergeWorkspaceSplit = () => {
  isWorkspaceSplitActive.value = false;
};

const toggleWorkspaceSplit = () => {
  if (isWorkspaceSplitActive.value) {
    mergeWorkspaceSplit();
    return;
  }
  if (workspaceSplitAvailable.value) {
    isWorkspaceSplitActive.value = true;
  }
};

const orderedVisibleSessionTabs = computed(() => {
  const visibleTabsById = new Map(visibleSessionTabsWithStatus.value.map(tab => [tab.sessionId, tab]));
  const orderedTabs = workspaceTabOrder.value
    .map(sessionId => visibleTabsById.get(sessionId))
    .filter(Boolean) as typeof visibleSessionTabsWithStatus.value;
  const orderedIdSet = new Set(orderedTabs.map(tab => tab.sessionId));
  const missingTabs = visibleSessionTabsWithStatus.value.filter(tab => !orderedIdSet.has(tab.sessionId));
  return [...orderedTabs, ...missingTabs];
});

const workspaceSplitSessionIds = computed(() => orderedVisibleSessionTabs.value.map(tab => tab.sessionId));
const workspaceSplitShellSessionIds = computed(() => (
  workspaceSplitSessionIds.value.filter(sessionId => isTerminalShellSessionKind(sessionStore.sessions.get(sessionId)?.kind))
));
const isBatchTerminalInputAvailable = computed(() => (
  isWorkspaceSplitActive.value && workspaceSplitShellSessionIds.value.length > 1
));

watch(isBatchTerminalInputAvailable, (available) => {
  if (!available) {
    isBatchTerminalInputActive.value = false;
  }
});

const toggleBatchTerminalInput = () => {
  if (!isBatchTerminalInputAvailable.value) {
    isBatchTerminalInputActive.value = false;
    return;
  }
  isBatchTerminalInputActive.value = !isBatchTerminalInputActive.value;
};

watch(visibleSessionTabsWithStatus, (tabs) => {
  const visibleIds = new Set(tabs.map(tab => tab.sessionId));
  const nextOrder = workspaceTabOrder.value.filter(sessionId => visibleIds.has(sessionId));
  tabs.forEach((tab) => {
    if (!nextOrder.includes(tab.sessionId)) {
      nextOrder.push(tab.sessionId);
    }
  });
  workspaceTabOrder.value = nextOrder;
}, { immediate: true });

watch([workspaceSplitAvailable, isMobile], () => {
  if (!workspaceSplitAvailable.value || isMobile.value) {
    mergeWorkspaceSplit();
  }
});

watch(layoutActiveSessionId, (sessionId) => {
  if (sessionId && visibleSessionIds.value.includes(sessionId)) {
    lastVisibleLayoutActiveSessionId.value = sessionId;
  }
}, { immediate: true });

const handleWorkspaceSessionOrderUpdate = (newSessions: SessionTabInfoWithStatus[]) => {
  workspaceTabOrder.value = newSessions.map(session => session.sessionId);
};

// +++ Add computed property for mobile terminal layout node +++
const mobileLayoutNodeForTerminal = computed((): LayoutNode | null => {
  return {
    id: 'mobile-main-terminal-pane',
    type: 'pane' as const,
    component: 'terminal' as const,
    size: 100,
  };
});

// --- UI 状态 (保持本地) ---
const showAddEditForm = ref(false);
const connectionToEdit = ref<ConnectionInfo | null>(null);
const showLayoutConfigurator = ref(false); // 控制布局配置器可见性
// 本地 RDP 状态已被移除

const workspaceRootRef = ref<HTMLElement | null>(null);

// --- 文件管理器模态框状态 ---
const showFileManagerModal = ref(false);
const fileManagerModalRootRef = ref<HTMLElement | null>(null);
const fileManagerModalContentRef = ref<HTMLElement | null>(null);
const { centerDialog: centerFileManagerModal, startDialogDrag: startFileManagerModalDrag } = useDraggableDialog({
  rootRef: fileManagerModalRootRef,
  dialogRef: fileManagerModalContentRef,
});
type FileManagerModalProps = {
  sessionId: string;
  instanceId: string;
  dbConnectionId: string;
  wsDeps: WebSocketDependencies;
};
const fileManagerPropsMap = shallowRef<Map<string, FileManagerModalProps>>(new Map());
const currentFileManagerSessionId = ref<string | null>(null);
type PoppedOutTerminalState = {
  sessionId: string;
  windowRef: Window;
  app: VueApp;
  host: HTMLElement;
  sessionElement: HTMLElement;
  placeholder: Comment;
  closeTimer: number;
  closeHandler: () => void;
  focusHandler: () => void;
  resizeHandler: () => void;
  visibilityHandler: () => void;
};

type XtermWindowBoundTerminal = XtermTerminal & {
  _core?: {
    _coreBrowserService?: {
      window?: Window;
    };
    _renderService?: {
      _renderDebouncer?: {
        _parentWindow?: Window;
        _animationFrame?: number;
      };
    };
    viewport?: {
      syncScrollArea?: (immediate?: boolean) => void;
    };
  };
};

type NavigatorWithKeyboardLock = Navigator & {
  keyboard?: {
    lock?: (keyCodes?: string[]) => Promise<void>;
    unlock?: () => void;
  };
};

const poppedOutTerminalMap = shallowRef<Map<string, PoppedOutTerminalState>>(new Map());
let hasShownFullscreenKeyboardWarning = false;

const cssEscape = (value: string) => (
  window.CSS?.escape ? window.CSS.escape(value) : value.replace(/["\\]/g, '\\$&')
);

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char] ?? char));

const copyDocumentStyles = (targetDocument: Document) => {
  document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style').forEach((node) => {
    targetDocument.head.appendChild(node.cloneNode(true));
  });
};

const waitForPopupElement = async <T extends Element>(
  targetDocument: Document,
  selector: string,
  maxFrames = 12,
) => {
  for (let attempt = 0; attempt < maxFrames; attempt += 1) {
    const element = targetDocument.querySelector<T>(selector);
    if (element) {
      return element;
    }
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  return null;
};

const waitForWorkspaceElement = async <T extends Element>(
  workspaceRoot: HTMLElement,
  selector: string,
  maxFrames = 12,
) => {
  for (let attempt = 0; attempt < maxFrames; attempt += 1) {
    const element = workspaceRoot.querySelector<T>(selector);
    if (element) {
      return element;
    }
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  return null;
};

const getTerminalForSession = (sessionId: string) => (
  getSshSessionForAction(sessionId)?.terminalManager.terminalInstance?.value ?? null
);

const getTerminalSchedulerWindow = (sessionId: string) => {
  const state = poppedOutTerminalMap.value.get(sessionId);
  return state && !state.windowRef.closed ? state.windowRef : window;
};

const dispatchResizeOnWindow = (targetWindow: Window) => {
  try {
    const resizeEvent = targetWindow.document.createEvent('Event');
    resizeEvent.initEvent('resize', false, false);
    targetWindow.dispatchEvent(resizeEvent);
  } catch (error) {
    console.warn('[WorkspaceView] Failed to dispatch resize event on terminal window:', error);
  }
};

const REMOTE_DESKTOP_RESIZE_EVENT = 'remote-desktop:resize-request';
const TERMINAL_RESIZE_EVENT = 'terminal:resize-request';

const requestRemoteDesktopSessionResize = (sessionElement: HTMLElement) => {
  const eventWindow = sessionElement.ownerDocument.defaultView ?? window;
  sessionElement.dispatchEvent(new eventWindow.Event(REMOTE_DESKTOP_RESIZE_EVENT));
};

const requestTerminalSessionResize = (sessionElement: HTMLElement) => {
  const eventWindow = sessionElement.ownerDocument.defaultView ?? window;
  sessionElement.dispatchEvent(new eventWindow.Event(TERMINAL_RESIZE_EVENT));
};

const rebindXtermRenderWindow = (sessionId: string, targetWindow: Window) => {
  const terminal = getTerminalForSession(sessionId);
  if (!terminal) {
    return false;
  }

  const internalTerminal = terminal as XtermWindowBoundTerminal;
  const core = internalTerminal._core;
  const coreBrowserService = core?._coreBrowserService;
  const renderDebouncer = core?._renderService?._renderDebouncer;
  let didRebind = false;

  // xterm keeps render timers on the window used at open(); moving DOM alone leaves rendering tied to the opener.
  if (coreBrowserService && coreBrowserService.window !== targetWindow) {
    coreBrowserService.window = targetWindow;
    didRebind = true;
  }

  if (renderDebouncer) {
    if (renderDebouncer._animationFrame !== undefined && renderDebouncer._parentWindow) {
      try {
        renderDebouncer._parentWindow.cancelAnimationFrame(renderDebouncer._animationFrame);
      } catch (error) {
        console.warn(`[WorkspaceView] Failed to cancel previous xterm render frame for session ${sessionId}:`, error);
      }
      renderDebouncer._animationFrame = undefined;
    }
    if (renderDebouncer._parentWindow !== targetWindow) {
      renderDebouncer._parentWindow = targetWindow;
      didRebind = true;
    }
  }

  if (!coreBrowserService && !renderDebouncer) {
    console.warn(`[WorkspaceView] Unable to rebind xterm render window for session ${sessionId}; internal render services were not found.`);
    return false;
  }

  try {
    core?.viewport?.syncScrollArea?.(true);
    dispatchResizeOnWindow(targetWindow);
    terminal.refresh(0, Math.max(terminal.rows - 1, 0));
  } catch (error) {
    console.warn(`[WorkspaceView] Failed to refresh xterm after window rebind for session ${sessionId}:`, error);
  }

  return didRebind;
};

const restorePoppedOutTerminalElement = (sessionId: string) => {
  const state = poppedOutTerminalMap.value.get(sessionId);
  if (!state) {
    sessionStore.restorePoppedOutSession(sessionId);
    return;
  }

  const nextPoppedOutTerminalMap = new Map(poppedOutTerminalMap.value);
  nextPoppedOutTerminalMap.delete(sessionId);
  poppedOutTerminalMap.value = nextPoppedOutTerminalMap;

  window.clearInterval(state.closeTimer);
  try {
    state.windowRef.removeEventListener('beforeunload', state.closeHandler);
    state.windowRef.removeEventListener('focus', state.focusHandler);
    state.windowRef.removeEventListener('pageshow', state.focusHandler);
    state.windowRef.removeEventListener('resize', state.resizeHandler);
    state.windowRef.document.removeEventListener('visibilitychange', state.visibilityHandler);
  } catch (error) {
    console.warn(`[WorkspaceView] Failed to remove pop-out window listeners for session ${sessionId}:`, error);
  }
  state.app.unmount();
  if (state.placeholder.parentNode) {
    state.placeholder.parentNode.replaceChild(state.sessionElement, state.placeholder);
  }
  if (isTerminalShellSessionKind(sessionStore.sessions.get(state.sessionId)?.kind)) {
    rebindXtermRenderWindow(state.sessionId, window);
  }
  if (!state.windowRef.closed) {
    state.windowRef.close();
  }
  sessionStore.restorePoppedOutSession(state.sessionId);
  requestSessionResize(state.sessionId);
};

const restoreAllPoppedOutTerminalElements = () => {
  Array.from(poppedOutTerminalMap.value.keys()).forEach((sessionId) => {
    restorePoppedOutTerminalElement(sessionId);
  });
  sessionStore.restorePoppedOutSession();
};

const shouldPreservePoppedOutFocus = (element: Element | null) => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  return Boolean(element.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], .monaco-editor, .cm-editor'
  ));
};

const focusPoppedOutTerminal = (sessionId: string, options: { force?: boolean; resize?: boolean } = {}) => {
  const state = poppedOutTerminalMap.value.get(sessionId);
  const terminal = getTerminalForSession(sessionId);
  if (!terminal || state?.windowRef.closed) {
    return;
  }

  try {
    const activeElement = state?.windowRef.document.activeElement ?? null;
    if (!options.force && shouldPreservePoppedOutFocus(activeElement)) {
      return;
    }
  } catch (error) {
    console.warn(`[WorkspaceView] Failed to read pop-out focus state for session ${sessionId}:`, error);
  }

  const targetWindow = getTerminalSchedulerWindow(sessionId);
  targetWindow.requestAnimationFrame(() => {
    try {
      if (options.force && state && !state.windowRef.closed) {
        state.windowRef.focus();
      }
      if (options.resize) {
        window.dispatchEvent(new Event('resize'));
        if (state && !state.windowRef.closed) {
          dispatchResizeOnWindow(state.windowRef);
        }
      }
      terminal.refresh(0, Math.max(terminal.rows - 1, 0));
      terminal.focus();
    } catch (error) {
      console.warn(`[WorkspaceView] Failed to focus pop-out terminal for session ${sessionId}:`, error);
    }
  });
};

const focusPoppedOutSession = (sessionId: string, options: { force?: boolean; resize?: boolean } = {}) => {
  if (isTerminalShellSessionKind(sessionStore.sessions.get(sessionId)?.kind)) {
    focusPoppedOutTerminal(sessionId, options);
    return;
  }

  const state = poppedOutTerminalMap.value.get(sessionId);
  if (!state || state.windowRef.closed) return;

  try {
    if (options.force) {
      state.windowRef.focus();
    }
    if (options.resize) {
      dispatchResizeOnWindow(state.windowRef);
      requestRemoteDesktopSessionResize(state.sessionElement);
    }
  } catch (error) {
    console.warn(`[WorkspaceView] Failed to focus pop-out session ${sessionId}:`, error);
  }
};

const requestSessionResize = (sessionId: string) => {
  const session = sessionStore.sessions.get(sessionId);
  if (isTerminalShellSessionKind(session?.kind) || poppedOutTerminalMap.value.has(sessionId)) {
    focusPoppedOutSession(sessionId, { force: true, resize: true });
    return;
  }

  window.dispatchEvent(new Event('resize'));
};

const readKeyboardLockApi = () => (navigator as NavigatorWithKeyboardLock).keyboard;

const showFullscreenKeyboardWarning = () => {
  if (hasShownFullscreenKeyboardWarning) return;
  hasShownFullscreenKeyboardWarning = true;
  uiNotificationsStore.showWarning(t(
    'workspace.sessionFullscreen.keyboardLockUnavailable',
    '当前浏览器无法锁定 Esc，可能会单次 Esc 退出全屏。',
  ));
};

const lockFullscreenEscapeKey = async () => {
  const keyboard = readKeyboardLockApi();
  if (!keyboard?.lock) {
    showFullscreenKeyboardWarning();
    return;
  }

  try {
    await keyboard.lock(['Escape']);
  } catch (error) {
    console.warn('[WorkspaceView] Failed to lock Escape in fullscreen:', error);
    showFullscreenKeyboardWarning();
  }
};

const unlockFullscreenKeyboard = () => {
  try {
    readKeyboardLockApi()?.unlock?.();
  } catch (error) {
    console.warn('[WorkspaceView] Failed to unlock fullscreen keyboard:', error);
  }
};

const resetFullscreenEscPressCount = () => {
  fullscreenEscPressCount.value = 0;
  if (fullscreenEscResetTimer !== null) {
    window.clearTimeout(fullscreenEscResetTimer);
    fullscreenEscResetTimer = null;
  }
};

const isWorkspaceBrowserFullscreen = () => document.fullscreenElement === workspaceRootRef.value;

const exitWorkspaceBrowserFullscreen = async () => {
  if (!isWorkspaceBrowserFullscreen() || !document.exitFullscreen) {
    return;
  }

  try {
    await document.exitFullscreen();
  } catch (error) {
    console.warn('[WorkspaceView] Failed to exit browser fullscreen:', error);
  }
};

const clearSessionFullscreenState = () => {
  const sessionId = fullscreenSessionId.value;
  if (!sessionId) return;

  fullscreenSessionId.value = null;
  resetFullscreenEscPressCount();
  unlockFullscreenKeyboard();
  nextTick(() => requestSessionResize(sessionId));
};

const exitSessionFullscreen = () => {
  clearSessionFullscreenState();
  void exitWorkspaceBrowserFullscreen();
};

const applySessionFullscreen = (sessionId: string) => {
  fullscreenSessionId.value = sessionId;
  resetFullscreenEscPressCount();
  if (activeSessionId.value !== sessionId) {
    sessionStore.activateSession(sessionId);
  }
  void lockFullscreenEscapeKey();
  nextTick(() => requestSessionResize(sessionId));
};

const requestWorkspaceBrowserFullscreen = async () => {
  const fullscreenElement = workspaceRootRef.value;
  if (!fullscreenElement?.requestFullscreen) {
    uiNotificationsStore.showError(t(
      'workspace.sessionFullscreen.unsupported',
      '当前浏览器不支持全屏 API。',
    ));
    return false;
  }

  if (isWorkspaceBrowserFullscreen()) {
    return true;
  }

  try {
    await fullscreenElement.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch (error) {
    console.warn('[WorkspaceView] Failed to enter browser fullscreen:', error);
    uiNotificationsStore.showError(t(
      'workspace.sessionFullscreen.requestFailed',
      '进入全屏失败，请检查浏览器权限后重试。',
    ));
    return false;
  }
};

const enterSessionFullscreen = (sessionId: string) => {
  if (!sessionStore.sessions.has(sessionId)) {
    return;
  }

  void requestWorkspaceBrowserFullscreen().then((enteredFullscreen) => {
    if (enteredFullscreen) {
      applySessionFullscreen(sessionId);
    }
  });
};

const handleFullscreenSessionEvent = (payload: WorkspaceEventPayloads['session:fullscreen']) => {
  enterSessionFullscreen(payload.sessionId);
};

const handleFullscreenEscapeKey = (event: KeyboardEvent) => {
  if (!isSessionFullscreenActive.value) {
    return false;
  }

  if (event.key !== 'Escape') {
    resetFullscreenEscPressCount();
    return false;
  }

  if (event.repeat) {
    return false;
  }

  fullscreenEscPressCount.value += 1;
  if (fullscreenEscResetTimer !== null) {
    window.clearTimeout(fullscreenEscResetTimer);
  }

  if (fullscreenEscPressCount.value >= FULLSCREEN_ESC_PRESS_THRESHOLD) {
    event.preventDefault();
    event.stopPropagation();
    exitSessionFullscreen();
    return true;
  }

  fullscreenEscResetTimer = window.setTimeout(resetFullscreenEscPressCount, FULLSCREEN_ESC_SEQUENCE_TIMEOUT_MS);
  return false;
};

const handleDocumentFullscreenChange = () => {
  if (isWorkspaceBrowserFullscreen()) {
    if (fullscreenSessionId.value) {
      void lockFullscreenEscapeKey();
    }
    return;
  }

  if (fullscreenSessionId.value) {
    clearSessionFullscreenState();
  }
};

watch(visibleSessionTabsWithStatus, (tabs) => {
  const currentFullscreenSessionId = fullscreenSessionId.value;
  if (!currentFullscreenSessionId) return;

  if (!tabs.some(tab => tab.sessionId === currentFullscreenSessionId)) {
    fullscreenSessionId.value = null;
    resetFullscreenEscPressCount();
  }
});

const handlePopOutSession = async ({ sessionId, windowRef }: { sessionId: string; windowRef?: Window | null }) => {
  if (fullscreenSessionId.value === sessionId) {
    exitSessionFullscreen();
  }

  const workspaceRoot = workspaceRootRef.value;
  if (!workspaceRoot?.isConnected) {
    return;
  }

  const existingPoppedOutTerminal = poppedOutTerminalMap.value.get(sessionId);
  if (existingPoppedOutTerminal) {
    windowRef?.close();
    if (isTerminalShellSessionKind(sessionStore.sessions.get(sessionId)?.kind)) {
      rebindXtermRenderWindow(sessionId, existingPoppedOutTerminal.windowRef);
    }
    focusPoppedOutSession(sessionId, { force: true, resize: true });
    return;
  }

  const selector = `[data-terminal-session-id="${cssEscape(sessionId)}"]`;
  const sessionElement = await waitForWorkspaceElement<HTMLElement>(workspaceRoot, selector);
  if (!sessionElement?.parentNode) {
    console.warn(`[WorkspaceView] Cannot pop out session ${sessionId}: terminal element was not found.`);
    windowRef?.close();
    uiNotificationsStore.showError(t('workspace.sessionPopout.terminalNotFound', '未找到可弹出的终端会话，请稍后重试。'));
    return;
  }

  const sessionForPopout = sessionStore.sessions.get(sessionId);
  const isRemoteDesktopPopout = isRemoteDesktopSessionKind(sessionForPopout?.kind);
  const popoutLayoutTree = isRemoteDesktopPopout ? sessionOnlyLayoutNode.value : layoutTree.value;
  if (!popoutLayoutTree) {
    console.warn(`[WorkspaceView] Cannot pop out session ${sessionId}: layout tree is not ready.`);
    windowRef?.close();
    uiNotificationsStore.showError(t('workspace.sessionPopout.layoutNotReady', '终端布局尚未就绪，请稍后重试。'));
    return;
  }

  const popup = windowRef ?? window.open('', `fantetic-terminal-${sessionId}`, 'popup=yes,width=1200,height=800');
  if (!popup) {
    console.warn(`[WorkspaceView] Pop-out window was blocked for session ${sessionId}.`);
    uiNotificationsStore.showWarning(t('workspace.sessionPopout.blocked', '浏览器阻止了弹出窗口，请允许此站点弹出窗口后重试。'));
    return;
  }

  if (!sessionElement.parentNode) {
    popup.close();
    uiNotificationsStore.showError(t('workspace.sessionPopout.terminalNotFound', '未找到可弹出的终端会话，请稍后重试。'));
    return;
  }
  sessionElement.style.removeProperty('display');

  const sessionName = sessionStore.sessions.get(sessionId)?.connectionName || t('workspace.sessionPopout.title', '弹出会话');
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(sessionName)}</title></head><body></body></html>`);
  popup.document.close();
  copyDocumentStyles(popup.document);
  popup.document.body.className = document.body.className;
  popup.document.documentElement.className = document.documentElement.className;
  popup.document.documentElement.style.cssText = document.documentElement.style.cssText;
  popup.document.body.style.margin = '0';
  popup.document.body.style.overflow = 'hidden';
  popup.document.body.style.background = 'var(--app-bg-color)';
  const popoutStyle = popup.document.createElement('style');
  popoutStyle.textContent = `
    .external-session-popout {
      display: flex;
      width: 100vw;
      height: 100vh;
      flex-direction: column;
      overflow: hidden;
      background: var(--app-bg-color, #111);
      color: var(--text-color, #f5f5f5);
    }
    .external-session-popout-terminal {
      position: relative;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .external-session-popout-terminal .popout-workspace-root {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    .external-session-popout-terminal .layout-renderer-wrapper {
      flex: 1;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
  `;
  popup.document.head.appendChild(popoutStyle);

  const shell = popup.document.createElement('div');
  shell.className = 'external-session-popout';
  shell.innerHTML = `
    <div class="external-session-popout-terminal"></div>
  `;
  popup.document.body.appendChild(shell);

  const terminalHost = shell.querySelector<HTMLElement>('.external-session-popout-terminal');
  if (!terminalHost || !popoutLayoutTree) {
    popup.close();
    uiNotificationsStore.showError(t('workspace.sessionPopout.layoutNotReady', '终端布局尚未就绪，请稍后重试。'));
    return;
  }

  let popoutApp: VueApp;
  try {
    popoutApp = createApp({
      name: 'SessionPopoutWorkspace',
      setup() {
        const sessionEditorTabs = computed(() => getEditorTabsForSession(sessionId));
        const sessionActiveEditorTabId = computed(() => getActiveEditorTabIdForSession(sessionId));

        return () => h('div', { class: 'popout-workspace-root' }, [
          h(LayoutRenderer, {
            isRootRenderer: !isRemoteDesktopPopout,
            layoutNode: popoutLayoutTree,
            activeSessionId: sessionId,
            includedSessionId: sessionId,
            externalTerminalSessionId: sessionId,
            layoutLocked: layoutLockedBoolean.value,
            class: 'layout-renderer-wrapper',
            editorTabs: sessionEditorTabs.value,
            activeEditorTabId: sessionActiveEditorTabId.value,
            terminalInputHandler: handleTerminalInputData,
          }),
          h(FileEditorOverlay, {
            isMobile: isMobile.value,
            sessionId: sessionId,
          }),
          h(UINotificationDisplay),
          h(PopoutFileManagerModal, {
            ownerDocument: popup.document,
          }),
          h(ConfirmDialog, {
            visible: dialogStore.state.visible,
            title: dialogStore.state.title,
            message: dialogStore.state.message,
            confirmText: dialogStore.state.confirmText,
            cancelText: dialogStore.state.cancelText,
            isLoading: dialogStore.state.isLoading,
            teleportTarget: popup.document.body,
            onConfirm: dialogStore.handleConfirm,
            onCancel: dialogStore.handleCancel,
            'onUpdate:visible': (val: boolean) => {
              dialogStore.state.visible = val;
            },
          }),
        ]);
      },
    });
    if (appContext) {
      Object.assign(popoutApp._context.provides, appContext.provides);
      Object.assign(popoutApp._context.components, appContext.components);
      Object.assign(popoutApp._context.directives, appContext.directives);
      Object.assign(popoutApp.config.globalProperties, appContext.config.globalProperties);
    }
    popoutApp.use(i18n);
    popoutApp.mount(terminalHost);
    await nextTick();
  } catch (error) {
    console.error(`[WorkspaceView] Failed to mount pop-out workspace for session ${sessionId}:`, error);
    popup.close();
    uiNotificationsStore.showError(t('workspace.sessionPopout.mountFailed', '弹出终端挂载失败，请稍后重试。'));
    return;
  }

  const externalTerminalHost = await waitForPopupElement<HTMLElement>(
    popup.document,
    `[data-external-terminal-session-id="${cssEscape(sessionId)}"]`,
    30,
  );
  if (!externalTerminalHost) {
    popoutApp.unmount();
    popup.close();
    uiNotificationsStore.showError(t('workspace.sessionPopout.mountFailed', '弹出终端挂载失败，请稍后重试。'));
    return;
  }
  const placeholder = document.createComment(`popped-out-terminal-${sessionId}`);
  sessionElement.parentNode.replaceChild(placeholder, sessionElement);
  externalTerminalHost.appendChild(sessionElement);
  sessionStore.popOutSession(sessionId);
  if (isTerminalShellSessionKind(sessionStore.sessions.get(sessionId)?.kind)) {
    rebindXtermRenderWindow(sessionId, popup);
  }

  const closeTimer = window.setInterval(() => {
    if (popup.closed) {
      restorePoppedOutTerminalElement(sessionId);
      return;
    }
    try {
      if (popup.document.hasFocus()) {
        focusPoppedOutSession(sessionId);
      }
    } catch (error) {
      console.warn(`[WorkspaceView] Failed to keep pop-out terminal focused for session ${sessionId}:`, error);
    }
  }, 1500);

  const closeHandler = () => restorePoppedOutTerminalElement(sessionId);
  const focusHandler = () => focusPoppedOutSession(sessionId, { resize: true });
  const resizeHandler = () => {
    const sessionKind = sessionStore.sessions.get(sessionId)?.kind;
    if (isTerminalShellSessionKind(sessionKind)) {
      requestTerminalSessionResize(sessionElement);
    } else if (isRemoteDesktopSessionKind(sessionKind)) {
      requestRemoteDesktopSessionResize(sessionElement);
    }
  };
  const visibilityHandler = () => {
    if (popup.document.visibilityState === 'visible') {
      focusPoppedOutSession(sessionId, { resize: true });
    }
  };
  const nextPoppedOutTerminalMap = new Map(poppedOutTerminalMap.value);
  nextPoppedOutTerminalMap.set(sessionId, {
    sessionId,
    windowRef: popup,
    app: popoutApp,
    host: terminalHost,
    sessionElement,
    placeholder,
    closeTimer,
    closeHandler,
    focusHandler,
    resizeHandler,
    visibilityHandler,
  });
  poppedOutTerminalMap.value = nextPoppedOutTerminalMap;

  popup.addEventListener('beforeunload', closeHandler);
  popup.addEventListener('focus', focusHandler);
  popup.addEventListener('pageshow', focusHandler);
  popup.addEventListener('resize', resizeHandler);
  popup.document.addEventListener('visibilitychange', visibilityHandler);
  popup.focus();
  if (isRemoteDesktopPopout) {
    popup.requestAnimationFrame(() => {
      requestRemoteDesktopSessionResize(sessionElement);
      popup.requestAnimationFrame(() => requestRemoteDesktopSessionResize(sessionElement));
    });
  }
  requestSessionResize(sessionId);
};

// --- 处理全局键盘事件 ---
const handleGlobalKeyDown = (event: KeyboardEvent) => {
  if (handleFullscreenEscapeKey(event)) {
    return;
  }

  if (isSessionFullscreenActive.value) {
    return;
  }

  if (isSessionPopoutActive.value) {
    return;
  }

  // 检查是否按下了 Alt 键以及上/下箭头键
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault(); // 阻止默认行为 (例如页面滚动)

    const tabs = visibleSessionTabsWithStatus.value;
    const currentId = activeSessionId.value;

    if (!tabs || tabs.length <= 1 || !currentId) {
      // 如果没有标签页、只有一个标签页或没有活动标签页，则不执行任何操作
      return;
    }

    const currentIndex = tabs.findIndex(tab => tab.sessionId === currentId);
    if (currentIndex === -1) {
      // 如果找不到当前活动标签页 (理论上不应发生)，则不执行任何操作
      return;
    }

    let nextIndex: number;
    if (event.key === 'ArrowDown') {
      // Alt + 下箭头：切换到下一个标签页
      nextIndex = (currentIndex + 1) % tabs.length;
    } else {
      // Alt + 上箭头：切换到上一个标签页
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    }

    const nextSessionId = tabs[nextIndex].sessionId;
    if (nextSessionId !== currentId) {
      debugLog(`[WorkspaceView] Alt+${event.key} detected. Switching to session: ${nextSessionId}`);
      sessionStore.activateSession(nextSessionId);
    }
  }
};

const handleTerminalSendCommandEvent = (payload: WorkspaceEventPayloads['terminal:sendCommand']) => {
  handleSendCommand(payload.command, payload.sessionId);
};

const activateSessionFromTabBar = (sessionId: string) => {
  sessionStore.activateSession(sessionId);
};

const handleSessionActivateEvent = (payload: WorkspaceEventPayloads['session:activate']) => {
  activateSessionFromTabBar(payload.sessionId);
};

const handleToggleWorkspaceSplitEvent = (payload?: WorkspaceEventPayloads['ui:toggleWorkspaceSplit']) => {
  toggleWorkspaceSplit();
};

// --- 生命周期钩子 ---
onMounted(() => {
  debugLog('[工作区视图] 组件已挂载。');
  // 添加键盘事件监听器
  window.addEventListener('keydown', handleGlobalKeyDown, true);
  document.addEventListener('fullscreenchange', handleDocumentFullscreenChange);
  // 确保布局已初始化 (layoutStore 内部会处理)

  // +++ 订阅工作区事件 +++
  subscribeToWorkspaceEvents('terminal:sendCommand', handleTerminalSendCommandEvent);
  subscribeToWorkspaceEvents('terminal:input', handleTerminalInput);
  subscribeToWorkspaceEvents('terminal:resize', handleTerminalResize);
  subscribeToWorkspaceEvents('terminal:ready', handleTerminalReady);
  subscribeToWorkspaceEvents('terminal:clear', handleClearTerminal);
  subscribeToWorkspaceEvents('terminal:scrollToBottomRequest', handleScrollToBottomRequest);

  subscribeToWorkspaceEvents('editor:closeTab', (payload) => handleCloseEditorTab(payload.tabId));
  subscribeToWorkspaceEvents('editor:activateTab', (payload) => handleActivateEditorTab(payload.tabId));
  subscribeToWorkspaceEvents('editor:updateContent', handleUpdateEditorContent);
  subscribeToWorkspaceEvents('editor:saveTab', (payload) => handleSaveEditorTab(payload.tabId));
  subscribeToWorkspaceEvents('editor:changeEncoding', handleChangeEncoding);
  subscribeToWorkspaceEvents('editor:closeOtherTabs', (payload) => handleCloseOtherEditorTabs(payload.tabId));
  subscribeToWorkspaceEvents('editor:closeTabsToRight', (payload) => handleCloseEditorTabsToRight(payload.tabId));
  subscribeToWorkspaceEvents('editor:closeTabsToLeft', (payload) => handleCloseEditorTabsToLeft(payload.tabId));
  subscribeToWorkspaceEvents('editor:updateScrollPosition', handleEditorScrollPositionUpdate); // +++ 订阅滚动位置更新事件 +++
 
  // 移除对 connection:connect 事件的监听，以避免重复创建会话
  // subscribeToWorkspaceEvents('connection:connect', (payload) => handleConnectRequest(payload.connectionId));
  subscribeToWorkspaceEvents('connection:openNewSession', (payload) => handleOpenNewSession(payload.connectionId));
  subscribeToWorkspaceEvents('connection:requestAdd', handleRequestAddConnection);
  subscribeToWorkspaceEvents('connection:requestEdit', (payload) => handleRequestEditConnection(payload.connectionInfo));

  subscribeToWorkspaceEvents('ui:toggleWorkspaceSplit', handleToggleWorkspaceSplitEvent);

  // 来自 TerminalTabBar 的事件
  subscribeToWorkspaceEvents('session:activate', handleSessionActivateEvent);
  subscribeToWorkspaceEvents('session:close', (payload) => sessionStore.closeSession(payload.sessionId));
  subscribeToWorkspaceEvents('session:closeOthers', (payload) => handleCloseOtherSessions(payload.targetSessionId));
  subscribeToWorkspaceEvents('session:closeToRight', (payload) => handleCloseSessionsToRight(payload.targetSessionId));
  subscribeToWorkspaceEvents('session:closeToLeft', (payload) => handleCloseSessionsToLeft(payload.targetSessionId));
  subscribeToWorkspaceEvents('session:popOut', handlePopOutSession);
  subscribeToWorkspaceEvents('session:fullscreen', handleFullscreenSessionEvent);
  subscribeToWorkspaceEvents('ui:openLayoutConfigurator', handleOpenLayoutConfigurator);
  subscribeToWorkspaceEvents('fileManager:openModalRequest', handleFileManagerOpenRequest); // +++ 订阅文件管理器打开请求 +++
  subscribeToWorkspaceEvents('quickCommand:executeProcessed', handleQuickCommandExecuteProcessed);
});

onBeforeUnmount(() => {
  debugLog('[工作区视图] 组件即将卸载，清理所有会话...');
  restoreAllPoppedOutTerminalElements();
  // 移除键盘事件监听器
  window.removeEventListener('keydown', handleGlobalKeyDown, true);
  document.removeEventListener('fullscreenchange', handleDocumentFullscreenChange);
  resetFullscreenEscPressCount();
  unlockFullscreenKeyboard();
  sessionStore.cleanupAllSessions();
  workspaceEventSubscriptions.disposeAll();
});

const workspaceEventSubscriptions = createWorkspaceEventSubscriptionRegistry();
const subscribeToWorkspaceEvents = workspaceEventSubscriptions.subscribe;

 // --- 本地方法 (仅处理 UI 状态) ---
 const handleRequestAddConnection = () => {
   debugLog('[WorkspaceView] handleRequestAddConnection 被调用！');
   connectionToEdit.value = null;
   showAddEditForm.value = true;
 };

 const handleRequestEditConnection = (connection: ConnectionInfo) => {
   connectionToEdit.value = connection;
   showAddEditForm.value = true;
 };

 const handleFormClose = () => {
   showAddEditForm.value = false;
   connectionToEdit.value = null;
 };

 const handleConnectionAdded = () => {
   debugLog('[工作区视图] 连接已添加');
   handleFormClose();
 };

 const handleConnectionUpdated = () => {
   debugLog('[工作区视图] 连接已更新');
   handleFormClose();
 };

 // 处理打开和关闭布局配置器
 const handleOpenLayoutConfigurator = () => {
   showLayoutConfigurator.value = true;
 };
 const handleCloseLayoutConfigurator = () => {
   showLayoutConfigurator.value = false;
 };

 // --- 事件处理 (传递给 LayoutRenderer 或直接使用) ---

 // 处理命令发送 (用于 CommandBar, CommandHistory, QuickCommands)
 const handleSendCommand = (command: string, targetSessionId?: string) => {
   const sessionToCommand = getSshSessionForAction(targetSessionId);

   if (!sessionToCommand) {
     const idForLog = targetSessionId || 'active (none found)';
     console.warn(`[WorkspaceView] Cannot send command, no session found for ID: ${idForLog}.`);
     return;
   }
   const terminalManager = sessionToCommand.terminalManager as (SshTerminalInstance | undefined);

   if (terminalManager?.isSshConnected && !terminalManager.isSshConnected.value && command.trim() === '') {
     debugLog(`[WorkspaceView] Command bar Enter detected in disconnected session ${sessionToCommand.sessionId}, attempting reconnect...`);
     if (terminalManager.terminalInstance?.value) {
         terminalManager.terminalInstance.value.writeln(`\r\n\x1b[33m${t('workspace.terminal.reconnectingMsg')}\x1b[0m`);
     }
     const connectionInfo = connectionsStore.connections.find(c => c.id === Number(sessionToCommand.connectionId));
     if (connectionInfo) {
       sessionStore.handleConnectRequest(connectionInfo);
     } else {
       console.error(`[WorkspaceView] handleSendCommand: 未找到 ID 为 ${sessionToCommand.connectionId} 的连接信息。`);
     }
     return;
   }

   if (terminalManager && typeof terminalManager.sendData === 'function') {
     const commandToSend = command.trim(); // Keep trimmed for history
     debugLogLazy(() => [`[WorkspaceView] Sending command/data to session ${sessionToCommand.sessionId}: ${JSON.stringify(command)}`]);
     // Only append '\r' for regular commands, not for control characters like Ctrl+C (\x03)
     // Send the raw command as received by the function for control characters
     const dataToSend = command === '\x03' ? command : command + '\r';
     terminalManager.sendData(dataToSend);

     // Add to history only if it's a user-typed command (not just Enter or control chars)
     // And only if the command is being sent to the active session (to avoid polluting history from "send to all")
     if (commandToSend.length > 0 && command !== '\x03' && sessionToCommand.sessionId === activeSessionId.value) {
       commandHistoryStore.addCommand(commandToSend);
     }
   } else {
     console.warn(`[WorkspaceView] Cannot send command for session ${sessionToCommand.sessionId}, terminal manager or sendData method not available.`);
   }
 };

  const handleSingleTerminalInputData = (sessionId: string, data: string, batched?: boolean, localEcho = true) => {
   const manager = readTerminalInputManager(sessionId);
   if (!manager) {
     console.warn(`[WorkspaceView] handleTerminalInput: 未找到会话 ${sessionId} 或其 terminalManager`);
     return;
   }

    if (data !== '\r' || !manager.isSshConnected || manager.isSshConnected.value) {
      manager.handleTerminalData(data, { batched, localEcho });
     return;
   }

   const session = readTerminalInputSession(sessionId);
   if (!session) {
     console.warn(`[WorkspaceView] handleTerminalInput: 未找到会话 ${sessionId}`);
     return;
   }

   debugLog(`[WorkspaceView] 检测到在断开的会话 ${sessionId} 中按下回车，尝试重连...`);
   if (manager.terminalInstance?.value) {
     manager.terminalInstance.value.writeln(`\r\n\x1b[33m${t('workspace.terminal.reconnectingMsg')}\x1b[0m`);
   } else {
     console.warn(`[WorkspaceView] 无法写入重连提示，terminalInstance 不可用。`);
   }
   const connectionInfo = connectionsStore.connections.find(c => c.id === Number(session.connectionId));
   if (connectionInfo) {
     sessionStore.handleConnectRequest(connectionInfo);
   } else {
     console.error(`[WorkspaceView] handleTerminalInput: 未找到 ID 为 ${session.connectionId} 的连接信息。`);
   }
 };

 // 处理终端输入 (用于 Terminal)
 // 注意：LayoutRenderer 内部的 Terminal 组件需要 emit('terminal-input', sessionId, data)
 const handleTerminalInputData = (sessionId: string, data: string, batched?: boolean) => {
   const targetSessionIds = resolveTerminalBatchInputTargetIds({
     sourceSessionId: sessionId,
     batchEnabled: isBatchTerminalInputActive.value,
     workspaceSplitActive: isWorkspaceSplitActive.value,
     workspaceSplitSessionIds: workspaceSplitSessionIds.value,
     sessions: sessionStore.sessions,
   });

   if (targetSessionIds.length <= 1) {
     handleSingleTerminalInputData(sessionId, data, batched);
     return;
   }

    targetSessionIds.forEach(targetSessionId => {
      handleSingleTerminalInputData(targetSessionId, data, true, targetSessionId === sessionId);
    });
 };

 const handleTerminalInput = (payload: WorkspaceEventPayloads['terminal:input']) => {
   handleTerminalInputData(payload.sessionId, payload.data, payload.batched);
 };
 // 处理终端大小调整 (用于 Terminal)
 // 注意：LayoutRenderer 内部的 Terminal 组件需要 emit('terminal-resize', sessionId, dims)
 const handleTerminalResize = (payload: { sessionId: string; dims: { cols: number; rows: number } }) => {
    getSshSessionForAction(payload.sessionId)?.terminalManager.handleTerminalResize(payload.dims);
 };

// 终端搜索完全由 Terminal 组件维护，工作区只负责转交 xterm 实例。
const handleTerminalReady = (payload: { sessionId: string; terminal: XtermTerminal }) => {
  debugLog(`[工作区视图 ${payload.sessionId}] 收到 terminal-ready 事件。`);
  getSshSessionForAction(payload.sessionId)?.terminalManager.handleTerminalReady({ terminal: payload.terminal });
};

// +++ 处理清空终端事件 +++
const handleClearTerminal = (payload?: WorkspaceEventPayloads['terminal:clear']) => {
  const currentSession = getSshSessionForAction(payload?.sessionId);
  if (!currentSession) {
    console.warn('[WorkspaceView] Cannot clear terminal, no active session.');
    return;
  }
  const terminalManager = currentSession.terminalManager as (SshTerminalInstance | undefined);
  const mode = isMobile.value ? 'Mobile' : 'Desktop';

  if (terminalManager && terminalManager.terminalInstance?.value && typeof terminalManager.terminalInstance.value.clear === 'function') {
   debugLog(`[WorkspaceView ${mode}] Clearing terminal for active session ${currentSession.sessionId}`);
    terminalManager.terminalInstance.value.clear();
  } else {
    console.warn(`[WorkspaceView ${mode}] Cannot clear terminal for session ${currentSession.sessionId}, terminal manager, instance, or clear method not available.`);
  }
};

// +++ 处理滚动到底部请求 +++
const handleScrollToBottomRequest = (payload: { sessionId: string }) => {
  const terminalManager = getSshSessionForAction(payload.sessionId)?.terminalManager as (SshTerminalInstance | undefined);
  if (terminalManager?.terminalInstance?.value) {
   debugLog(`[WorkspaceView] Scrolling to bottom for session ${payload.sessionId}`);
    terminalManager.terminalInstance.value.scrollToBottom();
  } else {
    console.warn(`[WorkspaceView] Cannot scroll to bottom for session ${payload.sessionId}, terminal instance not found.`);
  }
};

// Removed computed properties for search results, will pass manager directly
// --- 编辑器操作处理 (用于 FileEditorContainer) ---
const handleCloseEditorTab = (tabId: string) => {
   const isShared = shareFileEditorTabsBoolean.value;
   debugLog(`[WorkspaceView] handleCloseEditorTab: ${tabId}, Shared mode: ${isShared}`);
   if (isShared) {
     fileEditorStore.closeTab(tabId);
   } else {
     const currentActiveSessionId = activeSessionId.value;
     const currentActiveSshSession = getSshSessionForAction(currentActiveSessionId ?? undefined);
     if (currentActiveSshSession) {
       sessionStore.closeEditorTabInSession(currentActiveSshSession.sessionId, tabId);
     } else {
        console.warn('[WorkspaceView] Cannot close editor tab: No active session in independent mode.');
     }
   }
 };

 const handleActivateEditorTab = (tabId: string) => {
   const isShared = shareFileEditorTabsBoolean.value;
   debugLog(`[WorkspaceView] handleActivateEditorTab: ${tabId}, Shared mode: ${isShared}`);
   if (isShared) {
     fileEditorStore.setActiveTab(tabId);
   } else {
     const currentActiveSessionId = activeSessionId.value;
     const currentActiveSshSession = getSshSessionForAction(currentActiveSessionId ?? undefined);
     if (currentActiveSshSession) {
       sessionStore.setActiveEditorTabInSession(currentActiveSshSession.sessionId, tabId);
     } else {
        console.warn('[WorkspaceView] Cannot activate editor tab: No active session in independent mode.');
     }
   }
 };

 const handleUpdateEditorContent = (payload: { tabId: string; content: string }) => {
   const isShared = shareFileEditorTabsBoolean.value;
   debugLog(`[WorkspaceView] handleUpdateEditorContent for tab ${payload.tabId}, Shared mode: ${isShared}`);
   if (isShared) {
     fileEditorStore.updateFileContent(payload.tabId, payload.content);
   } else {
     const currentActiveSessionId = activeSessionId.value;
     const currentActiveSshSession = getSshSessionForAction(currentActiveSessionId ?? undefined);
     if (currentActiveSshSession) {
       sessionStore.updateFileContentInSession(currentActiveSshSession.sessionId, payload.tabId, payload.content);
     } else {
        console.warn('[WorkspaceView] Cannot update editor content: No active session in independent mode.');
     }
   }
 };

 const handleSaveEditorTab = (tabId: string) => {
   const isShared = shareFileEditorTabsBoolean.value;
   debugLog(`[WorkspaceView] handleSaveEditorTab: ${tabId}, Shared mode: ${isShared}`);
   if (isShared) {
     fileEditorStore.saveFile(tabId);
   } else {
     const currentActiveSessionId = activeSessionId.value;
     const currentActiveSshSession = getSshSessionForAction(currentActiveSessionId ?? undefined);
     if (currentActiveSshSession) {
       sessionStore.saveFileInSession(currentActiveSshSession.sessionId, tabId);
     } else {
        console.warn('[WorkspaceView] Cannot save editor tab: No active session in independent mode.');
     }
   }
 };

 // +++ 处理编辑器编码更改事件 +++
 const handleChangeEncoding = (payload: { tabId: string; encoding: string }) => {
   const isShared = shareFileEditorTabsBoolean.value;
   debugLog(`[WorkspaceView] handleChangeEncoding for tab ${payload.tabId} to ${payload.encoding}, Shared mode: ${isShared}`);
   if (isShared) {
     fileEditorStore.changeEncoding(payload.tabId, payload.encoding);
   } else {
     const currentActiveSessionId = activeSessionId.value;
     const currentActiveSshSession = getSshSessionForAction(currentActiveSessionId ?? undefined);
     if (currentActiveSshSession) {
       // 假设 sessionStore 有一个 changeEncodingInSession 方法
       sessionStore.changeEncodingInSession(currentActiveSshSession.sessionId, payload.tabId, payload.encoding);
     } else {
        console.warn('[WorkspaceView] Cannot change editor encoding: No active session in independent mode.');
     }
   }
 };
 
 // +++ 处理编辑器滚动位置更新事件 (由 FileEditorContainer 发出) +++
 const handleEditorScrollPositionUpdate = (payload: { tabId: string; scrollTop: number; scrollLeft: number }) => {
   const { tabId, scrollTop, scrollLeft } = payload;
   if (shareFileEditorTabsBoolean.value) {
     fileEditorStore.updateTabScrollPosition(tabId, scrollTop, scrollLeft);
   } else {
     const currentActiveSession = getSshSessionForAction();
     if (currentActiveSession) {
       // 假设 tabId 在当前活动会话的编辑器标签中是唯一的
       sessionStore.updateTabScrollPositionInSession(currentActiveSession.sessionId, tabId, scrollTop, scrollLeft);
     } else {
        console.warn('[WorkspaceView] Cannot update editor scroll position: No active session in independent mode for tab:', tabId);
     }
   }
 };

 // --- 连接列表操作处理 (用于 WorkspaceConnectionList) ---
 const handleConnectRequest = (id: number) => {
   const connectionInfo = connectionsStore.connections.find(c => c.id === id);
   // console.log(`[WorkspaceView] Received 'connect-request' event for ID: ${id}`); // 保留原始日志或移除
   if (connectionInfo) {
     sessionStore.handleConnectRequest(connectionInfo);
   } else {
     console.error(`[WorkspaceView] handleConnectRequest: Connection info not found for ID ${id}.`); // 保留错误日志
   }
 };
 const handleOpenNewSession = (id: number) => {
   debugLog(`[WorkspaceView] Received 'open-new-session' event for ID: ${id}`);
    sessionStore.handleOpenNewSession(id);
  };

// RDP 事件处理方法已被移除

 // --- 标签页关闭操作处理 ---

 const handleCloseOtherSessions = (targetSessionId: string) => {
   const sessionsToClose = visibleSessionTabsWithStatus.value
     .filter(tab => tab.sessionId !== targetSessionId)
     .map(tab => tab.sessionId);
   sessionsToClose.forEach(id => sessionStore.closeSession(id));
 };

 const handleCloseSessionsToRight = (targetSessionId: string) => {
   const targetIndex = visibleSessionTabsWithStatus.value.findIndex(tab => tab.sessionId === targetSessionId);
   if (targetIndex === -1) return;
   const sessionsToClose = visibleSessionTabsWithStatus.value
     .slice(targetIndex + 1)
     .map(tab => tab.sessionId);
   sessionsToClose.forEach(id => sessionStore.closeSession(id));
 };

 const handleCloseSessionsToLeft = (targetSessionId: string) => {
   const targetIndex = visibleSessionTabsWithStatus.value.findIndex(tab => tab.sessionId === targetSessionId);
   if (targetIndex === -1) return;
   const sessionsToClose = visibleSessionTabsWithStatus.value
     .slice(0, targetIndex)
     .map(tab => tab.sessionId);
   sessionsToClose.forEach(id => sessionStore.closeSession(id));
 };

 const handleCloseOtherEditorTabs = (targetTabId: string) => {
   const tabsToClose = editorTabs.value
     .filter(tab => tab.id !== targetTabId)
     .map(tab => tab.id);
   tabsToClose.forEach(id => handleCloseEditorTab(id)); // Reuse existing close logic
 };

 const handleCloseEditorTabsToRight = (targetTabId: string) => {
   const targetIndex = editorTabs.value.findIndex(tab => tab.id === targetTabId);
   if (targetIndex === -1) return;
   const tabsToClose = editorTabs.value
     .slice(targetIndex + 1)
     .map(tab => tab.id);
   tabsToClose.forEach(id => handleCloseEditorTab(id));
 };

 const handleCloseEditorTabsToLeft = (targetTabId: string) => {
   const targetIndex = editorTabs.value.findIndex(tab => tab.id === targetTabId);
   if (targetIndex === -1) return;
   const tabsToClose = editorTabs.value
     .slice(0, targetIndex)
     .map(tab => tab.id);
   tabsToClose.forEach(id => handleCloseEditorTab(id));
 };

const readFileManagerModalProps = (sessionId: string, existingProps?: FileManagerModalProps): FileManagerModalProps | null => {
  const session = getSshSessionForAction(sessionId);
  if (!session) {
    console.error(`[WorkspaceView] Cannot open file manager: Session ${sessionId} not found.`);
    // TODO: Show error notification
    return null;
  }

  // 1. 获取 dbConnectionId
  const dbConnectionId = session.connectionId;
  if (!dbConnectionId) {
    console.error(`[WorkspaceView] Cannot open file manager: Missing dbConnectionId for session ${sessionId}.`);
    // TODO: Show error notification
    return null;
  }

  // 2. 获取 wsDeps (从 session.wsManager 获取)
  if (!session.wsManager) {
     console.error(`[WorkspaceView] Cannot open file manager: wsManager not found for session ${sessionId}.`);
      // TODO: Show error notification
      return null;
  }
  const wsDeps: WebSocketDependencies = {
      sendMessage: session.wsManager.sendMessage,
      onMessage: session.wsManager.onMessage,
      getBufferedAmount: session.wsManager.getBufferedAmount,
      isConnected: session.wsManager.isConnected,
      isSftpReady: session.wsManager.isSftpReady,
  };

  if (!wsDeps) {
      // 如果 wsDeps 仍然为 null，则无法继续
     console.error(`[WorkspaceView] Cannot open file manager: wsDeps are null after attempting retrieval for session ${sessionId}.`);
      return null;
  }

  // 3. 生成或获取 instanceId
  const instanceId = existingProps ? existingProps.instanceId : `fm-modal-${sessionId}`;

  return {
    sessionId,
    instanceId,
    dbConnectionId: String(dbConnectionId), // 确保是 string
    wsDeps,
  };
};

const PopoutFileManagerModal = {
  name: 'PopoutFileManagerModal',
  props: {
    ownerDocument: {
      type: Object as PropType<Document>,
      required: true,
    },
  },
  setup(props: { ownerDocument: Document }) {
    const isVisible = ref(false);
    const modalRootRef = ref<HTMLElement | null>(null);
    const modalContentRef = ref<HTMLElement | null>(null);
    const propsMap = shallowRef<Map<string, FileManagerModalProps>>(new Map());
    const currentSessionId = ref<string | null>(null);
    let disposeOpenModalSubscription = () => {};
    const { centerDialog, startDialogDrag } = useDraggableDialog({
      rootRef: modalRootRef,
      dialogRef: modalContentRef,
    });

    const openModal = (payload: WorkspaceEventPayloads['fileManager:openModalRequest']) => {
      if (payload.sourceDocument && payload.sourceDocument !== props.ownerDocument) return;

      const nextProps = readFileManagerModalProps(payload.sessionId, propsMap.value.get(payload.sessionId));
      if (!nextProps) return;

      propsMap.value.set(payload.sessionId, nextProps);
      currentSessionId.value = payload.sessionId;
      isVisible.value = true;
      centerDialog();
    };

    const closeModal = () => {
      isVisible.value = false;
    };

    onMounted(() => {
      disposeOpenModalSubscription = subscribeToWorkspaceEvents('fileManager:openModalRequest', openModal);
    });

    onBeforeUnmount(() => {
      disposeOpenModalSubscription();
    });

    return () => {
      const activeSessionId = currentSessionId.value;
      const activeProps = activeSessionId ? propsMap.value.get(activeSessionId) : null;
      if (!isVisible.value || !activeSessionId || !activeProps) return null;

      const sessionName = sessionStore.sessions.get(activeSessionId)?.connectionName || activeSessionId;
      return h('div', {
        ref: modalRootRef,
        class: 'file-manager-modal-root fixed inset-0 flex items-center justify-center z-50 p-4',
        style: { backgroundColor: 'var(--overlay-bg-color)' },
        onClick: (event: MouseEvent) => {
          if (event.target === event.currentTarget) closeModal();
        },
      }, [
        h('div', {
          ref: modalContentRef,
          class: 'file-manager-modal-content bg-background rounded-lg shadow-xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden border border-border',
        }, [
          h('div', {
            class: 'flex justify-between items-center p-3 border-b border-border flex-shrink-0 bg-header cursor-move select-none',
            onPointerdown: startDialogDrag,
          }, [
            h('h2', { class: 'text-lg font-semibold text-foreground' }, `${t('fileManager.modalTitle', '文件管理器')} (${sessionName})`),
            h('button', {
              class: 'text-text-secondary hover:text-foreground transition-colors',
              onPointerdown: (event: PointerEvent) => event.stopPropagation(),
              onClick: closeModal,
            }, [
              h('i', { class: 'fas fa-times text-xl' }),
            ]),
          ]),
          h('div', { class: 'file-manager-modal-body flex-grow overflow-hidden' }, [
            h(FileManager, {
              sessionId: activeProps.sessionId,
              instanceId: activeProps.instanceId,
              dbConnectionId: activeProps.dbConnectionId,
              wsDeps: activeProps.wsDeps,
              isMobile: isMobile.value,
              class: 'h-full',
            }),
          ]),
        ]),
      ]);
    };
  },
};

// --- 文件管理器模态框处理 ---
const handleFileManagerOpenRequest = (payload: WorkspaceEventPayloads['fileManager:openModalRequest']) => {
  const ownerDocument = workspaceRootRef.value?.ownerDocument ?? document;
  if (payload.sourceDocument && payload.sourceDocument !== ownerDocument) return;

  const { sessionId } = payload;
  const newProps = readFileManagerModalProps(sessionId, fileManagerPropsMap.value.get(sessionId));
  if (!newProps) return;

  fileManagerPropsMap.value.set(sessionId, newProps);
  currentFileManagerSessionId.value = sessionId;
  showFileManagerModal.value = true;
  centerFileManagerModal();
  debugLog(`[WorkspaceView] Opening FileManager modal with props for session ${sessionId}:`, newProps);
};

// --- 处理 quickCommand:executeProcessed 事件 ---
const handleQuickCommandExecuteProcessed = (payload: WorkspaceEventPayloads['quickCommand:executeProcessed']) => {
  const { command, sessionId: targetSessionId } = payload;
  debugLog(`[WorkspaceView] Received quickCommand:executeProcessed event. Command: "${command}", TargetSessionID: ${targetSessionId}`);

  // 使用现有的 handleSendCommand 逻辑来发送指令
  // handleSendCommand 会处理 sessionId 未定义时使用 activeSessionId 的情况
  handleSendCommand(command, targetSessionId);
};

const closeFileManagerModal = () => {
  showFileManagerModal.value = false;
  debugLog('[WorkspaceView] FileManager modal hidden (kept alive).');
};

</script>

<template>
  <!-- *** 动态 class 绑定，添加 is-mobile 类 *** -->
  <div ref="workspaceRootRef" :class="['workspace-view', { 'with-header': isHeaderVisible, 'is-mobile': isMobile, 'is-session-popout-active': isSessionPopoutActive, 'is-session-fullscreen-active': isSessionFullscreenActive }]">
    <!-- --- 桌面端布局 --- -->
    <template v-if="!isMobile">
      <div class="workspace-panel">
        <TerminalTabBar
          v-if="!isSessionFullscreenActive"
          :sessions="orderedVisibleSessionTabs"
          :active-session-id="visibleActiveSessionId"
          :is-mobile="isMobile"
          :split-workspace-available="workspaceSplitAvailable"
          :merge-workspace-available="isWorkspaceSplitActive"
          :workspace-split-active="isWorkspaceSplitActive"
          :batch-terminal-input-active="isBatchTerminalInputActive"
          :batch-terminal-input-available="isBatchTerminalInputAvailable"
          :show-layout-actions="!isVisibleActiveSessionRemoteDesktop"
          :show-split-action="true"
          @update:sessions="handleWorkspaceSessionOrderUpdate"
          @toggle-batch-terminal-input="toggleBatchTerminalInput"
        />
        <div class="main-content-area">
          <LayoutRenderer
              v-if="layoutTree"
              :is-root-renderer="!isTerminalOnlyMode"
              :layout-node="layoutTree"
              :active-session-id="layoutActiveSessionId"
              :popped-out-session-ids="poppedOutSessionIds"
              :workspace-split-active="isWorkspaceSplitActive"
              :workspace-split-session-ids="workspaceSplitSessionIds"
              :terminal-only-mode="isTerminalOnlyMode"
              :fullscreen-session-id="fullscreenSessionId"
              :layout-locked="layoutLockedBoolean"
              :terminal-input-handler="handleTerminalInputData"
              class="layout-renderer-wrapper"
              :editor-tabs="editorTabs"
              :active-editor-tab-id="activeEditorTabId"
            ></LayoutRenderer>
            <div v-else class="pane-placeholder">
              {{ t('layout.loading', '加载布局中...') }}
            </div>
          </div>
      </div>
    </template>

    <!-- --- 移动端布局 --- -->
    <template v-else>
      <TerminalTabBar
        v-if="!isSessionFullscreenActive"
        :sessions="visibleSessionTabsWithStatus"
        :active-session-id="visibleActiveSessionId"
        :is-mobile="isMobile"
        :split-workspace-available="false"
        :show-layout-actions="!isVisibleActiveSessionRemoteDesktop"
      />
      <div class="mobile-content-area">
          <LayoutRenderer
          v-if="layoutActiveSessionId && mobileLayoutNodeForTerminal"
          :layout-node="mobileLayoutNodeForTerminal"
          :active-session-id="layoutActiveSessionId"
          :popped-out-session-ids="poppedOutSessionIds"
          :is-root-renderer="false"
          :terminal-only-mode="isSessionFullscreenActive"
          :fullscreen-session-id="fullscreenSessionId"
          :layout-locked="layoutLockedBoolean"
          :terminal-input-handler="handleTerminalInputData"
          class="layout-renderer-wrapper flex-grow overflow-auto"
          :editor-tabs="editorTabs"
          :active-editor-tab-id="activeEditorTabId"
        />
        <div v-else class="pane-placeholder">
          {{ t('workspace.noActiveSession', '没有活动的会话') }}
        </div>
      </div>
    </template>

    <!-- Modals 保持不变，应在布局之外 -->
    <AddConnectionFormComponent
      v-if="showAddEditForm"
      :connection-to-edit="connectionToEdit"
      @close="handleFormClose"
      @connection-added="handleConnectionAdded"
      @connection-updated="handleConnectionUpdated"
    />

    <LayoutConfigurator
      :is-visible="showLayoutConfigurator"
      @close="handleCloseLayoutConfigurator"
    />

    <!-- RDP Modal is now rendered in App.vue -->
    <!-- VNC Modal is now rendered in App.vue -->

    <!-- FileManager Modal Container -->
    <div ref="fileManagerModalRootRef" v-show="showFileManagerModal && currentFileManagerSessionId && fileManagerPropsMap.get(currentFileManagerSessionId)" class="file-manager-modal-root fixed inset-0 flex items-center justify-center z-50 p-4" :style="{ backgroundColor: 'var(--overlay-bg-color)' }" @click.self="closeFileManagerModal">
      <div ref="fileManagerModalContentRef" class="file-manager-modal-content bg-background rounded-lg shadow-xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden border border-border">
        <div class="flex justify-between items-center p-3 border-b border-border flex-shrink-0 bg-header cursor-move select-none" @pointerdown="startFileManagerModalDrag">
          <h2 class="text-lg font-semibold text-foreground">{{ t('fileManager.modalTitle', '文件管理器') }} ({{ currentFileManagerSessionId ? (sessionStore.sessions.get(currentFileManagerSessionId)?.connectionName || currentFileManagerSessionId) : '未知会话' }})</h2>
          <button @pointerdown.stop @click="closeFileManagerModal" class="text-text-secondary hover:text-foreground transition-colors">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
        <div class="file-manager-modal-body flex-grow overflow-hidden">
          <template v-for="propsData in fileManagerPropsMap.values()" :key="`${propsData.sessionId}-${isMobile}`">
            <div v-show="propsData.sessionId === currentFileManagerSessionId" class="h-full">
              <FileManager
                :session-id="propsData.sessionId"
                :instance-id="propsData.instanceId"
                :db-connection-id="propsData.dbConnectionId"
                :ws-deps="propsData.wsDeps"
                :is-mobile="isMobile"
                class="h-full"
              />
            </div>
          </template>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.workspace-view {
  display: flex;
  background-color: transparent;
  flex-direction: column;
  height: 100dvh; /* 使用动态视口高度 */
  overflow: hidden;
  transition: height 0.3s ease; /* 可选：添加过渡效果 */
}

/* 主导航已改为左侧 dock，可见性不再影响工作区纵向高度。 */

.workspace-panel {
  display: flex;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.file-manager-modal-content {
  max-width: min(56rem, calc(100vw - 2rem));
}

.file-manager-modal-body {
  min-width: 0;
}

.main-content-area {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden; /* Keep overflow hidden */
    border: 0px solid var(--border-color, #ccc); /* Use variable for border */
    border-top: none; /* Remove top border as it's handled by the tab bar */
    border-radius: 0 0 5px 5px; /* Top-left, Top-right, Bottom-right, Bottom-left */
    margin: var(--base-margin, 0.5rem); /* Add some margin around the content area */
    margin-top: 0; /* Remove top margin if tab bar is directly above */
}

.workspace-view.is-session-fullscreen-active .main-content-area,
.workspace-view.is-session-fullscreen-active .mobile-content-area {
  margin: 0;
  border: none;
  border-radius: 0;
}

.layout-renderer-wrapper {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* 面板占位符样式 (用于加载或错误状态) */
.pane-placeholder {
    flex-grow: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    text-align: center;
    color: var(--text-color-secondary); /* Use secondary text color variable */
    background-color: var(--header-bg-color); /* Use header background for slight contrast */
    font-size: 0.9em;
    padding: var(--base-padding); /* Use base padding variable */
}


/* --- Mobile Layout Styles --- */
.workspace-view.is-mobile {
  /* Ensure flex column layout */
  display: flex; /* Uncommented */
  flex-direction: column; /* Uncommented */
  --mobile-virtual-keyboard-height: min(42dvh, 19.5rem);
  /* Height is already handled by .workspace-view and .with-header */
}

.workspace-view.is-mobile .main-content-area {
  /* Hide the desktop content area in mobile view */
  display: none;
}

.mobile-content-area {
  display: flex; /* Use flex for the terminal container */
  flex-direction: column; /* Stack elements vertically if needed */
  flex-grow: 1; /* Allow this area to take up remaining space */
  overflow: hidden; /* Prevent overflow */
  position: relative; /* Needed for potential absolute positioning inside */
  /* Remove desktop margins/borders */
  margin: 0;
  border: none;
  border-radius: 0;
}

.mobile-terminal {
  flex-grow: 1; /* Terminal takes all available space in mobile-content-area */
  width: 100%;
  overflow: hidden;
}

.mobile-command-bar {
  flex-shrink: 0; /* Prevent command bar from shrinking */
  /* Add specific styles if needed, e.g., border-top */
  border-top: 1px solid var(--border-color, #ccc);
}

.mobile-virtual-keyboard {
  flex-shrink: 0; /* 防止虚拟键盘缩小 */
  width: 100%; /* 确保宽度为 100% */
  height: var(--mobile-virtual-keyboard-height);
  max-height: var(--mobile-virtual-keyboard-height);
  box-sizing: border-box; /* 边框和内边距包含在宽度内 */
  /* 可以添加更多样式，例如背景色、边框等 */
}

@media (max-width: 768px) {
  .file-manager-modal-root {
    padding: 0.5rem;
  }

  .file-manager-modal-content {
    width: min(100%, calc(100vw - 1rem));
    max-width: calc(100vw - 1rem);
    height: min(85dvh, calc(100dvh - 1rem));
    max-height: calc(100dvh - 1rem);
  }

  .file-manager-modal-body {
    overflow-x: auto;
  }
}



</style>

<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from './stores/auth.store';
import { useDeviceDetection } from './composables/useDeviceDetection';
import { useSettingsStore } from './stores/settings.store';
import { useAppearanceStore, safeJsonParse } from './stores/appearance.store';
import { useUiNotificationsStore } from './stores/uiNotifications.store';
import { useLayoutStore } from './stores/layout.store';
import { useFocusSwitcherStore } from './stores/focusSwitcher.store';
import { useSessionStore } from './stores/session.store';
import { useFavoritePathsStore } from './stores/favoritePaths.store';
import { storeToRefs } from 'pinia';
import UINotificationDisplay from './components/UINotificationDisplay.vue';
import FileEditorOverlay from './components/FileEditorOverlay.vue';
import FocusSwitcherConfigurator from './components/FocusSwitcherConfigurator.vue';
import VncModal from './components/VncModal.vue';
import ConfirmDialog from './components/common/ConfirmDialog.vue';
import { useDialogStore } from './stores/dialog.store';
import SettingsView from './views/SettingsView.vue';
import { darkUiTheme, defaultUiTheme } from './features/appearance/config/default-themes';
import { debugLog } from './composables/useDebugLog';

const { t } = useI18n();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const appearanceStore = useAppearanceStore();
const uiNotificationsStore = useUiNotificationsStore();
const layoutStore = useLayoutStore();
const focusSwitcherStore = useFocusSwitcherStore(); // +++ 实例化焦点切换 Store +++
const sessionStore = useSessionStore(); // +++ 实例化 Session Store +++
const dialogStore = useDialogStore(); // +++ 实例化 DialogStore +++
const { state: dialogState } = storeToRefs(dialogStore); 
const favoritePathsStore = useFavoritePathsStore(); // +++ 实例化 favoritePathsStore +++
const { isAuthenticated } = storeToRefs(authStore);
const { showPopupFileEditorBoolean } = storeToRefs(settingsStore);
const { isLayoutVisible, isHeaderVisible } = storeToRefs(layoutStore); // 添加 isHeaderVisible
const { isConfiguratorVisible: isFocusSwitcherVisible } = storeToRefs(focusSwitcherStore);
const { isVncModalOpen, vncConnectionInfo } = storeToRefs(sessionStore); // +++ 获取 VNC 状态 +++
const { isMobile } = useDeviceDetection();

const route = useRoute();
const DOCK_WIDTH_STORAGE_KEY = 'fantetic_dock_width';
const DOCK_COLLAPSED_STORAGE_KEY = 'fantetic_dock_collapsed';
const DOCK_DEFAULT_WIDTH = 80;
const DOCK_MIN_WIDTH = 76;
const DOCK_MAX_WIDTH = 280;
const DOCK_EXPANDED_WIDTH = 148;
const DOCK_WIDTH_STEP = 16;
const THEME_REVEAL_DURATION = 680;
const CONNECTIONS_SERVER_PANEL_COLLAPSED_KEY = 'connections_view_server_panel_collapsed';
const CONNECTIONS_SERVER_PANEL_COLLAPSED_EVENT = 'fantetic:connections-server-panel-collapsed';

type ViewTransitionLike = {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition: () => void;
};

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => ViewTransitionLike;
};

const primaryNavItems = computed(() => [
  { to: '/', label: t('nav.dashboard'), icon: 'fas fa-chart-line' },
  { to: '/connections', label: t('nav.connections'), icon: 'fas fa-server' },
  { to: '/audit-logs', label: t('nav.auditLogs'), icon: 'fas fa-shield-halved' },
]);

// +++ 存储上一次由切换器聚焦的 ID +++
const lastFocusedIdBySwitcher = ref<string | null>(null);
const isAltPressed = ref(false); // 跟踪 Alt 键是否按下
const altShortcutKey = ref<string | null>(null);
const dockWidth = ref(DOCK_DEFAULT_WIDTH);
const isDockCollapsed = ref(false);
const isDockHovering = ref(false);
const isDockResizing = ref(false);
const dockRef = ref<HTMLElement | null>(null);
const dockHoverBarRef = ref<HTMLElement | null>(null);
const dockActionMenuRef = ref<HTMLElement | null>(null);
const isDockActionMenuHovering = ref(false);
const isSettingsDialogVisible = ref(false);
const isSwitchingDockTheme = ref(false);
const isConnectionsServerPanelCollapsed = ref(localStorage.getItem(CONNECTIONS_SERVER_PANEL_COLLAPSED_KEY) === 'true');
let dockHoverFrameId: number | null = null;
let pendingDockHoverPoint: { x: number; y: number } | null = null;
let dockHoverRectCache: { dock?: DOMRect; hoverBar?: DOMRect; actionMenu?: DOMRect; stamp: number } | null = null;
const DOCK_HOVER_RECT_CACHE_MS = 120;
// --- 移除 shortcutTriggeredInKeyDown 标志 ---

onMounted(() => {
  // +++ 全局 Alt 键监听器 +++
  window.addEventListener('keydown', handleAltKeyDown); // +++ 监听 keydown 设置状态 +++
  window.addEventListener('keyup', handleGlobalKeyUp);   // +++ 监听 keyup 执行切换 +++
  document.addEventListener('mousemove', handleDockHoverTracking);
  window.addEventListener('mouseout', handleDockMouseOut);
  window.addEventListener(CONNECTIONS_SERVER_PANEL_COLLAPSED_EVENT, handleConnectionsServerPanelCollapsedChange);
  
  // PWA Install Prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    debugLog('[App.vue] beforeinstallprompt event fired. Browser will handle install prompt.');
  });

  window.addEventListener('appinstalled', () => {
    debugLog('[App.vue] PWA was installed');
  });
  
  // +++ 加载 Header 可见性状态 +++
  layoutStore.loadHeaderVisibility();
  loadDockPreferences();

});

// +++ 监听用户认证状态，登录后初始化收藏路径 +++
watch(isAuthenticated, (loggedIn) => {
  if (loggedIn) {
    favoritePathsStore.initializeFavoritePaths(t);
  }
}, { immediate: true });

watch([dockWidth, isDockCollapsed, isDockActionMenuHovering], () => {
  invalidateDockHoverRectCache();
});

// +++ 卸载钩子以移除监听器 +++
onUnmounted(() => {
  window.removeEventListener('keydown', handleAltKeyDown); // +++ 移除 keydown 监听 +++
  window.removeEventListener('keyup', handleGlobalKeyUp);   // +++ 移除 keyup 监听 +++
  document.removeEventListener('mousemove', handleDockHoverTracking);
  window.removeEventListener('mouseout', handleDockMouseOut);
  window.removeEventListener(CONNECTIONS_SERVER_PANEL_COLLAPSED_EVENT, handleConnectionsServerPanelCollapsedChange);
  if (dockHoverFrameId !== null) {
    window.cancelAnimationFrame(dockHoverFrameId);
    dockHoverFrameId = null;
  }
  stopDockResize();
});


const normalizedRoutePath = computed(() => {
  const currentPath = route.path.replace(/\/+$/, '');
  return currentPath || '/';
});

// *** 计算属性，判断是否在 workspace 路由 ***
const isWorkspaceRoute = computed(() => normalizedRoutePath.value === '/workspace');
const isConnectionsRoute = computed(() => normalizedRoutePath.value === '/connections');
const isAuthRoute = computed(() => normalizedRoutePath.value === '/login' || normalizedRoutePath.value === '/setup');
const shouldAllowDock = computed(() => !isAuthRoute.value && (!isWorkspaceRoute.value || isHeaderVisible.value));
const shouldRenderDock = computed(() => shouldAllowDock.value && !(isConnectionsRoute.value && isConnectionsServerPanelCollapsed.value));
const shouldShowDockHoverBar = computed(() => shouldRenderDock.value && isDockCollapsed.value);
const shouldShowDockResizeHandle = computed(() => shouldRenderDock.value && !isConnectionsRoute.value);
const isDockOpen = computed(() => !isDockCollapsed.value || isDockHovering.value);
const isDockExpanded = computed(() => dockWidth.value >= DOCK_EXPANDED_WIDTH);
const dockStyle = computed(() => ({
  '--dock-width': `${dockWidth.value}px`
}));
const isDarkUiThemeActive = computed(() => {
  const userTheme = safeJsonParse<Record<string, string>>(appearanceStore.appearanceSettings.customUiTheme, {});
  const mergedTheme = { ...defaultUiTheme, ...userTheme };

  return mergedTheme['--app-bg-color'] === darkUiTheme['--app-bg-color']
    && mergedTheme['--header-bg-color'] === darkUiTheme['--header-bg-color']
    && mergedTheme['--text-color'] === darkUiTheme['--text-color'];
});
const dockThemeToggleLabel = computed(() => (
  isDarkUiThemeActive.value
    ? t('dock.themeToDefault', '默认主题')
    : t('dock.themeToDark', '暗黑主题')
));


const handleLogout = () => {
  authStore.logout();
};

const handleConnectionsServerPanelCollapsedChange = (event: Event) => {
  const customEvent = event as CustomEvent<{ collapsed?: boolean }>;
  isConnectionsServerPanelCollapsed.value = Boolean(customEvent.detail?.collapsed);
};

type DockThemeMode = 'default' | 'dark';

const applyDockThemeToggle = async (): Promise<DockThemeMode> => {
  if (isDarkUiThemeActive.value) {
    await appearanceStore.resetCustomUiTheme();
    return 'default';
  } else {
    await appearanceStore.saveCustomUiTheme(darkUiTheme);
    return 'dark';
  }
};

const shouldReduceThemeMotion = () => {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

const getThemeRevealOrigin = (event?: MouseEvent) => {
  const target = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (event && event.detail > 0) {
    return { x: event.clientX, y: event.clientY };
  }

  if (target) {
    const rect = target.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  return {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };
};

const getThemeRevealClipPath = (x: number, y: number) => {
  const farthestX = Math.max(x, window.innerWidth - x);
  const farthestY = Math.max(y, window.innerHeight - y);
  const radius = Math.ceil(Math.hypot(farthestX, farthestY));

  return {
    from: `circle(0px at ${x}px ${y}px)`,
    to: `circle(${radius}px at ${x}px ${y}px)`,
  };
};

const runThemeRevealTransition = async <T,>(event: MouseEvent | undefined, updateTheme: () => Promise<T>) => {
  const transitionDocument = document as DocumentWithViewTransition;
  if (!transitionDocument.startViewTransition || shouldReduceThemeMotion()) {
    return updateTheme();
  }

  const { x, y } = getThemeRevealOrigin(event);
  const { from, to } = getThemeRevealClipPath(x, y);
  const root = document.documentElement;
  let updateResult: T | undefined;
  const transitionAnimationOptions: KeyframeAnimationOptions & { pseudoElement?: string } = {
    duration: THEME_REVEAL_DURATION,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    pseudoElement: '::view-transition-new(root)',
  };

  root.classList.add('theme-radial-reveal-active');
  const transition = transitionDocument.startViewTransition(async () => {
    updateResult = await updateTheme();
    await nextTick();
  });

  const revealAnimation = transition.ready
    .then(() => root.animate({ clipPath: [from, to] }, transitionAnimationOptions).finished)
    .catch(() => undefined);

  try {
    await transition.updateCallbackDone;
    await revealAnimation;
    await transition.finished.catch(() => undefined);
  } finally {
    root.classList.remove('theme-radial-reveal-active');
  }

  return updateResult as T;
};

const toggleDockTheme = async (event?: MouseEvent) => {
  if (isSwitchingDockTheme.value) return;

  isSwitchingDockTheme.value = true;
  try {
    const appliedMode = await runThemeRevealTransition(event, applyDockThemeToggle);
    if (appliedMode === 'default') {
      uiNotificationsStore.showInfo(t('dock.defaultThemeApplied', '默认主题已应用'));
    } else {
      uiNotificationsStore.showSuccess(t('dock.darkThemeApplied', '暗黑主题已应用'));
    }
  } catch (error: any) {
    console.error('[App] Failed to toggle dock theme:', error);
    uiNotificationsStore.showError(t('styleCustomizer.uiThemeSaveFailed', { message: error.message || t('common.error', '未知错误') }));
  } finally {
    isSwitchingDockTheme.value = false;
  }
};

const clampDockWidth = (width: number) => {
  return Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, Math.round(width)));
};

const loadDockPreferences = () => {
  try {
    const savedWidth = Number(localStorage.getItem(DOCK_WIDTH_STORAGE_KEY));
    if (Number.isFinite(savedWidth) && savedWidth > 0) {
      dockWidth.value = clampDockWidth(savedWidth);
    }
    isDockCollapsed.value = localStorage.getItem(DOCK_COLLAPSED_STORAGE_KEY) === 'true';
  } catch (error) {
    console.warn('[App] Failed to load dock preferences:', error);
  }
};

const saveDockWidth = () => {
  try {
    localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, String(dockWidth.value));
  } catch (error) {
    console.warn('[App] Failed to save dock width:', error);
  }
};

const saveDockCollapsed = () => {
  try {
    localStorage.setItem(DOCK_COLLAPSED_STORAGE_KEY, String(isDockCollapsed.value));
  } catch (error) {
    console.warn('[App] Failed to save dock collapsed state:', error);
  }
};

const hideDock = () => {
  isDockCollapsed.value = true;
  isDockHovering.value = false;
  stopDockResize();
  saveDockCollapsed();
};

const showDock = () => {
  isDockCollapsed.value = false;
  isDockHovering.value = false;
  saveDockCollapsed();
};

const toggleDockCollapse = () => {
  if (isDockCollapsed.value) {
    showDock();
  } else {
    hideDock();
  }
};

const resetDockWidth = () => {
  dockWidth.value = DOCK_DEFAULT_WIDTH;
  saveDockWidth();
};

const nudgeDockWidth = (delta: number) => {
  dockWidth.value = clampDockWidth(dockWidth.value + delta);
  saveDockWidth();
};

const handleDockResize = (event: PointerEvent) => {
  const nextWidth = event.clientX;
  if (nextWidth <= DOCK_MIN_WIDTH - 16) {
    hideDock();
    return;
  }

  dockWidth.value = clampDockWidth(nextWidth);
};

const stopDockResize = () => {
  if (!isDockResizing.value) return;

  isDockResizing.value = false;
  window.removeEventListener('pointermove', handleDockResize);
  window.removeEventListener('pointerup', stopDockResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  saveDockWidth();
};

const startDockResize = (event: PointerEvent) => {
  if (isMobile.value || isConnectionsRoute.value) return;

  event.preventDefault();
  isDockResizing.value = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', handleDockResize);
  window.addEventListener('pointerup', stopDockResize);
};

const isPointInRect = (rect: DOMRect | undefined, x: number, y: number) => {
  return Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
};

const invalidateDockHoverRectCache = () => {
  dockHoverRectCache = null;
};

const readDockHoverRects = () => {
  const now = performance.now();
  if (dockHoverRectCache && now - dockHoverRectCache.stamp < DOCK_HOVER_RECT_CACHE_MS) {
    return dockHoverRectCache;
  }

  dockHoverRectCache = {
    dock: dockRef.value?.getBoundingClientRect(),
    hoverBar: dockHoverBarRef.value?.getBoundingClientRect(),
    actionMenu: isDockActionMenuHovering.value ? dockActionMenuRef.value?.getBoundingClientRect() : undefined,
    stamp: now,
  };

  return dockHoverRectCache;
};

const updateDockHoverFromPoint = (x: number, y: number) => {
  if (!isDockCollapsed.value || !shouldAllowDock.value || isMobile.value) {
    if (isDockHovering.value) isDockHovering.value = false;
    return;
  }

  const rects = readDockHoverRects();
  const nextHovering = isPointInRect(rects.dock, x, y)
    || isPointInRect(rects.hoverBar, x, y)
    || isPointInRect(rects.actionMenu, x, y);

  if (isDockHovering.value !== nextHovering) {
    isDockHovering.value = nextHovering;
  }
};

const setDockActionMenuHovering = (value: boolean) => {
  if (isDockActionMenuHovering.value === value) return;
  isDockActionMenuHovering.value = value;
  invalidateDockHoverRectCache();
};

const handleDockHoverTracking = (event: MouseEvent) => {
  pendingDockHoverPoint = { x: event.clientX, y: event.clientY };
  if (dockHoverFrameId !== null) return;

  dockHoverFrameId = window.requestAnimationFrame(() => {
    dockHoverFrameId = null;
    if (!pendingDockHoverPoint) return;

    const { x, y } = pendingDockHoverPoint;
    pendingDockHoverPoint = null;
    updateDockHoverFromPoint(x, y);
  });
};

const handleDockMouseOut = (event: MouseEvent) => {
  if (isDockCollapsed.value && !event.relatedTarget) {
    isDockHovering.value = false;
  }
};

const openSettingsDialog = () => {
  isSettingsDialogVisible.value = true;
};

const closeSettingsDialog = () => {
  isSettingsDialogVisible.value = false;
};

// +++ 处理 Alt 键按下的事件处理函数，并记录快捷键 +++
const handleAltKeyDown = async (event: KeyboardEvent) => { // +++ 改为 async +++
  if (!isWorkspaceRoute.value) return; // 只在 workspace 路由下执行
  // 只在 Alt 键首次按下时设置状态
  if (event.key === 'Alt' && !event.repeat) {
    isAltPressed.value = true;
    altShortcutKey.value = null;
    // console.log('[App] Alt key pressed down.');
  } else if (isAltPressed.value && !['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
    // 如果 Alt 正被按住，且按下了非修饰键 (移除 !shortcutTriggeredInKeyDown 检查)
    let key = event.key;
    if (key.length === 1) key = key.toUpperCase();

    if (/^[a-zA-Z0-9]$/.test(key)) {
        altShortcutKey.value = key; // 记录按键
        const shortcutString = `Alt+${key}`;
        debugLog(`[App] KeyDown: Alt+${key} detected. Checking shortcut: ${shortcutString}`);
        const targetId = focusSwitcherStore.getFocusTargetIdByShortcut(shortcutString);

        if (targetId) {
            debugLog(`[App] KeyDown: Shortcut match found. Targeting ID: ${targetId}`);
            event.preventDefault(); // 阻止默认行为 (如菜单)
            const success = await focusSwitcherStore.focusTarget(targetId); // +++ 立即尝试聚焦 +++
            if (success) {
                debugLog(`[App] KeyDown: Successfully focused ${targetId} via shortcut.`);
                lastFocusedIdBySwitcher.value = targetId;
                // --- 移除设置标志位 ---
            } else {
                debugLog(`[App] KeyDown: Failed to focus ${targetId} via shortcut action.`);
                // 聚焦失败，可以选择是否取消 Alt 状态，暂时不处理，让 keyup 重置
            }
        } else {
            debugLog(`[App] KeyDown: No configured shortcut found for ${shortcutString}.`);
            // 没有匹配的快捷键，可以选择取消 Alt 状态以允许默认行为，或保持状态等待 keyup
            // isAltPressed.value = false;
            // altShortcutKey.value = null;
        }
    } else {
        // 按下无效键 (非字母数字)，取消 Alt 状态
        isAltPressed.value = false;
        altShortcutKey.value = null;
        // --- 移除重置标志位 ---
        debugLog('[App] KeyDown: Alt sequence cancelled by non-alphanumeric key press.');
    }
  } else if (isAltPressed.value && ['Control', 'Shift', 'Meta'].includes(event.key)) {
      // 按下其他修饰键，取消 Alt 状态
      isAltPressed.value = false;
      altShortcutKey.value = null;
      // --- 移除重置标志位 ---
      debugLog('[App] KeyDown: Alt sequence cancelled by other modifier key press.');
  }
};

// +++ 全局键盘事件处理函数，监听 keyup，优先处理快捷键 +++
const handleGlobalKeyUp = async (event: KeyboardEvent) => {
  if (!isWorkspaceRoute.value) return; // 只在 workspace 路由下执行
  if (event.key === 'Alt') {
    const altWasPressed = isAltPressed.value;
    const triggeredShortcutKey = altShortcutKey.value; // 记录松开时是否有记录的快捷键

    // 总是重置状态
    isAltPressed.value = false;
    altShortcutKey.value = null;
    // --- 移除重置标志位 ---

    if (altWasPressed && triggeredShortcutKey === null) {
      // 如果 Alt 之前是按下的，并且没有记录到有效的快捷键，则执行顺序切换
      debugLog('[App] KeyUp: Alt released without a valid shortcut key captured. Attempting sequential focus switch.');
      event.preventDefault(); // 仅在执行顺序切换时阻止默认行为

      // --- 顺序切换逻辑 (保持不变) ---
      let currentFocusId: string | null = lastFocusedIdBySwitcher.value;
      debugLog(`[App] Sequential switch. Last focused by switcher: ${currentFocusId}`);

      if (!currentFocusId) {
          const activeElement = document.activeElement as HTMLElement;
          if (activeElement && activeElement.hasAttribute('data-focus-id')) {
              currentFocusId = activeElement.getAttribute('data-focus-id');
              debugLog(`[App] Sequential switch. Found focus ID from activeElement: ${currentFocusId}`);
          } else {
              debugLog(`[App] Sequential switch. Could not determine current focus ID.`);
          }
      }

      const order = focusSwitcherStore.sequenceOrder; // ++ 使用新的 sequenceOrder state ++
      if (order.length === 0) { // ++ 检查新的 state ++
        debugLog('[App] No focus sequence configured.');
        return;
      }

      let focused = false;
      for (let i = 0; i < order.length; i++) { // ++ Use order.length for loop condition ++
        const nextFocusId = focusSwitcherStore.getNextFocusTargetId(currentFocusId);
        if (!nextFocusId) {
          console.warn('[App] Could not determine next focus target ID in sequence.');
          break;
        }

        debugLog(`[App] Sequential switch. Trying to focus target ID: ${nextFocusId}`);
        const success = await focusSwitcherStore.focusTarget(nextFocusId);

        if (success) {
          debugLog(`[App] Successfully focused ${nextFocusId} sequentially.`);
          lastFocusedIdBySwitcher.value = nextFocusId;
          focused = true;
          break;
        } else {
          debugLog(`[App] Failed to focus ${nextFocusId} sequentially. Trying next...`);
          currentFocusId = nextFocusId;
        }
      }

      if (!focused) {
        debugLog('[App] Cycled through sequence, no target could be focused.');
        lastFocusedIdBySwitcher.value = null;
      }
      // --- 顺序切换逻辑结束 ---

    } else if (altWasPressed && triggeredShortcutKey !== null) {
      debugLog(`[App] KeyUp: Alt released after capturing key '${triggeredShortcutKey}'. Shortcut logic handled in keydown. No sequential switch.`);
      // 快捷键逻辑已在 keydown 处理，keyup 时无需操作，也不阻止默认行为（除非特定需要）
    } else {
      // Alt 松开，但 isAltPressed 已经是 false (例如被其他键取消了)
      debugLog('[App] KeyUp: Alt released, but sequence was already cancelled or not active.');
    }
  }
};

// +++ 辅助函数：检查元素是否可见且可聚焦 +++
const isElementVisibleAndFocusable = (element: HTMLElement): boolean => {
  if (!element) return false;
  // 检查元素是否在 DOM 中，并且没有 display: none
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  // 检查元素或其父元素是否被禁用
  if ((element as HTMLInputElement).disabled) return false;
  let parent = element.parentElement;
  while (parent) {
    if ((parent as HTMLFieldSetElement).disabled) return false;
    parent = parent.parentElement;
  }
  // 检查元素是否足够在视口内（粗略检查）
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};



</script>

<template>
  
  <div id="app-container">
    <aside
      v-if="shouldRenderDock"
      ref="dockRef"
      :class="[
        'app-dock',
        {
          'dock-expanded': isDockExpanded,
          'dock-resizing': isDockResizing,
          'dock-collapsed': isDockCollapsed,
          'dock-open': isDockOpen,
          'dock-attached-to-server': isConnectionsRoute
        }
      ]"
      :style="dockStyle"
      :aria-label="t('nav.mainNavigation')"
    >
      <div class="dock-top">
        <div class="dock-head">
          <button
            type="button"
            class="dock-logo"
            :aria-label="isDockCollapsed ? t('dock.show', '显示导航栏') : t('dock.hide', '隐藏导航栏')"
            @click="toggleDockCollapse"
          >
            <img src="./assets/logo.png" :alt="t('appName')">
            <span class="dock-link-label">
              {{ isDockCollapsed ? t('dock.show', '显示导航栏') : t('dock.hide', '隐藏导航栏') }}
            </span>
          </button>
        </div>

        <nav class="dock-nav" :aria-label="t('nav.mainNavigation')">
          <RouterLink
            v-for="item in primaryNavItems"
            :key="item.to"
            :to="item.to"
            :class="['dock-link', { 'dock-link-active': normalizedRoutePath === item.to }]"
            :aria-label="item.label"
          >
            <i :class="[item.icon, 'iconClass' in item ? item.iconClass : undefined]"></i>
            <span class="dock-link-label">{{ item.label }}</span>
          </RouterLink>
        </nav>
      </div>

      <div class="dock-theme-area">
        <button
          type="button"
          class="dock-link dock-theme-toggle"
          :aria-label="dockThemeToggleLabel"
          :title="dockThemeToggleLabel"
          :disabled="isSwitchingDockTheme"
          @click="toggleDockTheme"
        >
          <i :class="isDarkUiThemeActive ? 'fas fa-sun' : 'fas fa-moon'"></i>
          <span class="dock-link-label">{{ dockThemeToggleLabel }}</span>
        </button>
      </div>

      <div class="dock-bottom">
        <div class="dock-actions" @mouseenter="setDockActionMenuHovering(true)" @mouseleave="setDockActionMenuHovering(false)">
          <button type="button" class="dock-link dock-menu-trigger" :aria-label="t('dock.actions', '操作菜单')">
            <i class="fas fa-user-gear"></i>
            <span class="dock-link-label">{{ t('dock.actions', '操作菜单') }}</span>
          </button>
          <div ref="dockActionMenuRef" class="dock-action-menu">
            <button
              type="button"
              :class="['dock-menu-item', { active: normalizedRoutePath === '/settings' || isSettingsDialogVisible }]"
              @click="openSettingsDialog"
            >
              <i class="fas fa-gear"></i>
              <span>{{ t('nav.settings') }}</span>
            </button>
            <RouterLink
              v-if="!isAuthenticated"
              to="/login"
              :class="['dock-menu-item', { active: normalizedRoutePath === '/login' }]"
            >
              <i class="fas fa-right-to-bracket"></i>
              <span>{{ t('nav.login') }}</span>
            </RouterLink>
            <button v-else type="button" class="dock-menu-item danger" @click="handleLogout">
              <i class="fas fa-right-from-bracket"></i>
              <span>{{ t('nav.logout') }}</span>
            </button>
          </div>
        </div>
      </div>

      <button
        v-if="shouldShowDockResizeHandle"
        type="button"
        class="dock-resize-handle"
        :title="t('dock.resize', '拖拽调整导航栏宽度')"
        :aria-label="t('dock.resize', '拖拽调整导航栏宽度')"
        @pointerdown="startDockResize"
        @dblclick="resetDockWidth"
        @keydown.left.prevent="nudgeDockWidth(-DOCK_WIDTH_STEP)"
        @keydown.right.prevent="nudgeDockWidth(DOCK_WIDTH_STEP)"
      />
    </aside>

    <div
      v-if="shouldShowDockHoverBar"
      ref="dockHoverBarRef"
      class="dock-hover-bar active"
      :title="t('dock.show', '显示导航栏')"
      :aria-label="t('dock.show', '显示导航栏')"
      role="button"
      tabindex="0"
      @focus="isDockHovering = true"
      @blur="isDockHovering = false"
      @keydown.enter.prevent="showDock"
      @keydown.space.prevent="showDock"
    />

    <main>
      <!-- 使用 KeepAlive 包裹 RouterView，并指定缓存 WorkspaceView -->
      <RouterView v-slot="{ Component }">
        <KeepAlive :include="['WorkspaceView', 'ConnectionsView']">
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </main>

    <!-- 添加全局通知显示 -->
    <UINotificationDisplay />

    <!-- 根据设置条件渲染全局文件编辑器弹窗 -->
    <FileEditorOverlay v-if="showPopupFileEditorBoolean" :is-mobile="isMobile" />

    <SettingsView v-if="isSettingsDialogVisible" is-dialog @close="closeSettingsDialog" />

    <!-- +++ 条件渲染焦点切换配置器 (使用 v-show 保持实例) +++ -->
    <FocusSwitcherConfigurator
      v-show="isFocusSwitcherVisible"
      :isVisible="isFocusSwitcherVisible"
      @close="focusSwitcherStore.toggleConfigurator(false)"
    />

    <!-- +++ 条件渲染 VNC 模态框 +++ -->
    <VncModal
      v-if="isVncModalOpen"
      :connection="vncConnectionInfo"
      @close="sessionStore.closeVncModal()"
    />

    <!-- +++ 全局确认对话框 +++ -->
    <ConfirmDialog
          :visible="dialogState.visible"
          :title="dialogState.title"
          :message="dialogState.message"
          :confirm-text="dialogState.confirmText"
          :cancel-text="dialogState.cancelText"
          :is-loading="dialogState.isLoading"
          @confirm="dialogStore.handleConfirm"
          @cancel="dialogStore.handleCancel"
          @update:visible="(val: boolean) => dialogStore.state.visible = val"
        />

  </div>
</template>

<style scoped>
#app-container {
  position: relative;
  display: flex;
  min-height: 100dvh;
  height: 100dvh;
  width: 100vw;
  overflow: hidden;
  font-family: var(--font-family-sans-serif); /* 使用字体变量 */
}

.app-dock {
  position: relative;
  left: 0;
  top: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  width: var(--dock-width);
  min-width: var(--dock-width);
  height: 100dvh;
  padding: 0.5rem;
  background: var(--header-bg-color);
  border-right: 1px solid var(--border-color);
  box-shadow: 2px 0 18px rgba(15, 23, 42, 0.08);
  user-select: none;
  transform: translateX(0);
  transition: width 0.16s ease, min-width 0.16s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.app-dock.dock-collapsed {
  position: absolute;
  transform: translateX(-100%);
  box-shadow: none;
  pointer-events: none;
}

.app-dock.dock-collapsed.dock-open {
  transform: translateX(0);
  box-shadow: 6px 0 28px rgba(15, 23, 42, 0.18);
  pointer-events: auto;
}

.app-dock.dock-collapsed .dock-resize-handle {
  display: none;
}

.app-dock.dock-resizing {
  transition: none;
  box-shadow: 4px 0 24px rgba(15, 23, 42, 0.14);
}

.app-dock.dock-attached-to-server {
  border-right-color: color-mix(in srgb, var(--border-color) 45%, transparent);
  box-shadow: none;
}

.dock-hover-bar {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 25;
  width: 2.5rem;
  height: 100%;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.dock-hover-bar::after {
  content: "";
  position: absolute;
  left: 0;
  top: 0.75rem;
  bottom: 0.75rem;
  width: 0.45rem;
  border-radius: 0 999px 999px 0;
  background: color-mix(in srgb, var(--header-bg-color) 86%, var(--border-color));
  opacity: 0.66;
  transition: opacity 0.12s ease, background-color 0.12s ease, width 0.12s ease;
}

.dock-hover-bar:hover::after,
.dock-hover-bar:focus-visible::after {
  width: 0.65rem;
  opacity: 1;
  background: color-mix(in srgb, var(--link-active-color) 34%, var(--header-bg-color));
}

.dock-hover-bar.active {
  display: block;
}

.dock-head {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin-bottom: 1rem;
}

.dock-top,
.dock-theme-area,
.dock-bottom,
.dock-nav {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.dock-top {
  min-height: 0;
  flex: 1;
}

.dock-nav {
  flex: 1;
  gap: 0.55rem;
  overflow: visible;
  padding: 0.25rem 0;
  scrollbar-width: none;
}

.dock-expanded .dock-nav {
  overflow-x: hidden;
}

.dock-nav::-webkit-scrollbar {
  display: none;
}

.dock-theme-area {
  flex-shrink: 0;
  margin-bottom: 0.5rem;
}

.dock-bottom {
  position: relative;
  flex-shrink: 0;
  gap: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  overflow: visible;
}

.dock-logo {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.75rem;
  height: 3.75rem;
  flex-shrink: 0;
  border: 1px solid transparent;
  border-radius: 1rem;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  transition: background-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
}

.dock-logo:hover {
  background: var(--nav-item-active-bg-color);
  box-shadow: inset 0 0 0 1px var(--border-color);
  transform: translateY(-1px);
}

.dock-expanded .dock-logo {
  justify-content: flex-start;
  width: 100%;
  gap: 0.75rem;
  padding: 0 0.65rem;
}

.dock-logo img {
  display: block;
  max-width: 2.75rem;
  max-height: 2.75rem;
  object-fit: contain;
}

.dock-link {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  width: 3.7rem;
  height: 3.7rem;
  flex-shrink: 0;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 1rem;
  background: transparent;
  color: var(--icon-color);
  cursor: pointer;
  transition: color 0.12s ease, background-color 0.12s ease, border-color 0.12s ease;
}

.dock-expanded .dock-link {
  justify-content: flex-start;
  width: 100%;
  padding: 0 0.85rem;
}

.dock-link:hover,
.dock-link:focus-visible {
  color: var(--link-hover-color);
  background: transparent;
  border-color: transparent;
}

.dock-link-active,
.dock-link.router-link-exact-active {
  color: var(--link-active-color);
  background: var(--nav-item-active-bg-color);
  border-color: color-mix(in srgb, var(--link-active-color) 45%, var(--border-color));
}

.dock-actions:hover .dock-menu-trigger,
.dock-actions:focus-within .dock-menu-trigger {
  color: var(--link-active-color);
  background: var(--nav-item-active-bg-color);
  border-color: color-mix(in srgb, var(--link-active-color) 45%, var(--border-color));
}

.dock-theme-toggle:disabled {
  cursor: wait;
  opacity: 0.58;
}

.dock-link i {
  width: 1.55rem;
  flex-shrink: 0;
  color: currentColor;
  font-size: 1.5rem;
  line-height: 1;
  text-align: center;
}

.dock-icon-proxies {
  transform: translateX(-0.08rem);
}

.dock-link-label {
  position: absolute;
  left: calc(100% + 0.6rem);
  top: 50%;
  z-index: 100;
  max-width: 14rem;
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--app-bg-color);
  color: var(--text-color);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16);
  font-size: 0.8rem;
  line-height: 1.2;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translate(-0.1rem, -50%);
  transition: opacity 0.08s ease, transform 0.08s ease;
}

.dock-expanded .dock-link-label,
.dock-expanded .dock-logo .dock-link-label {
  position: static;
  max-width: none;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: currentColor;
  box-shadow: none;
  font-size: 0.9rem;
  font-weight: 600;
  overflow: hidden;
  opacity: 1;
  pointer-events: auto;
  text-overflow: ellipsis;
  transform: none;
}

.dock-link:hover .dock-link-label,
.dock-link:focus-visible .dock-link-label,
.dock-logo:hover .dock-link-label,
.dock-logo:focus-visible .dock-link-label {
  opacity: 1;
  transform: translate(0, -50%);
}

.dock-expanded .dock-link:hover .dock-link-label,
.dock-expanded .dock-link:focus-visible .dock-link-label,
.dock-expanded .dock-logo:hover .dock-link-label,
.dock-expanded .dock-logo:focus-visible .dock-link-label {
  transform: none;
}

.dock-actions {
  position: relative;
  display: flex;
  justify-content: center;
  width: 100%;
}

.dock-action-menu {
  position: absolute;
  left: 0.5rem;
  bottom: calc(100% + 0.5rem);
  z-index: 100;
  min-width: 12.5rem;
  padding: 0.375rem;
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  background: var(--header-bg-color);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18);
  opacity: 0;
  pointer-events: none;
  transform: scale(0.95) translateY(0.5rem);
  transform-origin: left bottom;
  transition: opacity 0.12s cubic-bezier(0.4, 0, 0.2, 1), transform 0.12s cubic-bezier(0.4, 0, 0.2, 1);
}

.dock-action-menu::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -0.5rem;
  height: 0.5rem;
}

.dock-actions:hover .dock-action-menu,
.dock-actions:focus-within .dock-action-menu {
  opacity: 1;
  pointer-events: auto;
  transform: scale(1) translateY(0);
}

.dock-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1.2;
  text-align: left;
  transition: background-color 0.1s ease, color 0.1s ease;
}

.dock-menu-item i {
  width: 1.125rem;
  color: currentColor;
  font-size: 1rem;
  text-align: center;
}

.dock-menu-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dock-menu-item:hover,
.dock-menu-item:focus-visible,
.dock-menu-item.active {
  background: var(--nav-item-active-bg-color);
  color: var(--link-active-color);
}

.dock-menu-item.danger:hover,
.dock-menu-item.danger:focus-visible {
  background: color-mix(in srgb, var(--color-error) 14%, transparent);
  color: var(--color-error);
}

.dock-menu-item:disabled {
  cursor: wait;
  opacity: 0.58;
}

.dock-menu-item:disabled:hover,
.dock-menu-item:disabled:focus-visible {
  background: transparent;
  color: var(--text-color);
}

.dock-resize-handle {
  position: absolute;
  top: 0;
  right: -0.35rem;
  width: 0.7rem;
  height: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  cursor: col-resize;
}

.dock-resize-handle::after {
  content: "";
  position: absolute;
  top: 0.85rem;
  right: 0.25rem;
  bottom: 0.85rem;
  width: 2px;
  border-radius: 999px;
  background: transparent;
  transition: background-color 0.16s ease, box-shadow 0.16s ease;
}

.dock-resize-handle:hover::after,
.dock-resize-handle:focus-visible::after,
.dock-resizing .dock-resize-handle::after {
  background: var(--link-active-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--link-active-color) 18%, transparent);
}

main {
  flex-grow: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
}

@media (max-width: 768px) {
  .app-dock {
    position: relative;
    transform: none;
    pointer-events: auto;
    --dock-width: 4.25rem !important;
    min-width: var(--dock-width);
    padding: 0.375rem;
  }

  .app-dock.dock-collapsed {
    position: relative;
    transform: none;
    pointer-events: auto;
  }

  .dock-hover-bar {
    display: none;
  }

  .dock-action-menu {
    left: 0;
    min-width: 11.5rem;
  }

  .dock-head {
    margin-bottom: 0.75rem;
  }

  .dock-resize-handle {
    display: none;
  }

  .dock-logo,
  .dock-link {
    width: 3.25rem;
    height: 3.25rem;
    border-radius: 0.875rem;
  }

  .dock-logo img {
    max-width: 2.35rem;
    max-height: 2.35rem;
  }

  .dock-link i {
    font-size: 1.25rem;
  }

  .dock-link-label {
    display: none;
  }
}

</style>

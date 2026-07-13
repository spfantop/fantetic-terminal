<script setup lang="ts">
import { RouterView, useRoute, useRouter } from 'vue-router';
import { ref, onMounted, onUnmounted, watch, computed, defineAsyncComponent } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from './stores/auth.store';
import { useDeviceDetection } from './composables/useDeviceDetection';
import { useSettingsStore } from './stores/settings.store';
import { useFocusSwitcherStore } from './stores/focusSwitcher.store';
import { useSessionStore } from './stores/session.store';
import { useFileEditorStore } from './stores/fileEditor.store';
import { useFavoritePathsStore } from './stores/favoritePaths.store';
import { storeToRefs } from 'pinia';
import UINotificationDisplay from './components/UINotificationDisplay.vue';
import ConfirmDialog from './components/common/ConfirmDialog.vue';
import { useDialogStore } from './stores/dialog.store';
import { debugLog } from './composables/useDebugLog';
import {
  shouldEnableFocusSwitcherHotkeys,
  shouldSuppressFocusSwitcherKeyDefault,
} from './utils/focusSwitcherConfig';
import { isRemoteDesktopFeatureAvailable } from './utils/runtimeConfig';

const { t } = useI18n();
const remoteDesktopFeatureAvailable = isRemoteDesktopFeatureAvailable();
const isDesktopBuild = import.meta.env.VITE_FANTETIC_APP_MODE === 'electron';
const FileEditorOverlay = defineAsyncComponent(() => import('./components/FileEditorOverlay.vue'));
const FocusSwitcherConfigurator = defineAsyncComponent(() => import('./components/FocusSwitcherConfigurator.vue'));
const SettingsView = defineAsyncComponent(() => import('./views/SettingsView.vue'));
const AdminCenterView = defineAsyncComponent(() => import('./views/AdminCenterView.vue'));
const RemoteDesktopModal = isDesktopBuild
  ? null
  : defineAsyncComponent(() => import('./components/RemoteDesktopModal.vue'));
const VncModal = isDesktopBuild
  ? null
  : defineAsyncComponent(() => import('./components/VncModal.vue'));
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const fileEditorStore = useFileEditorStore();
const focusSwitcherStore = useFocusSwitcherStore(); // +++ 实例化焦点切换 Store +++
const sessionStore = useSessionStore(); // +++ 实例化 Session Store +++
const dialogStore = useDialogStore(); // +++ 实例化 DialogStore +++
const { state: dialogState } = storeToRefs(dialogStore); 
const favoritePathsStore = useFavoritePathsStore(); // +++ 实例化 favoritePathsStore +++
const { isAuthenticated } = storeToRefs(authStore);
const { showPopupFileEditorBoolean } = storeToRefs(settingsStore);
const { popupFileInfo } = storeToRefs(fileEditorStore);
const shouldMountPopupFileEditor = computed(() => showPopupFileEditorBoolean.value && popupFileInfo.value !== null);
const {
  isConfiguratorVisible: isFocusSwitcherVisible,
  configuratorSourceDocument: focusSwitcherConfiguratorSourceDocument,
} = storeToRefs(focusSwitcherStore);
const { isRdpModalOpen, rdpConnectionInfo, isVncModalOpen, vncConnectionInfo } = storeToRefs(sessionStore); // +++ 获取 RDP/VNC 状态 +++
const { isMobile } = useDeviceDetection();

const route = useRoute();
const router = useRouter();

// +++ 存储上一次由切换器聚焦的 ID +++
const lastFocusedIdBySwitcher = ref<string | null>(null);
const isAltPressed = ref(false); // 跟踪 Alt 键是否按下
const altShortcutKey = ref<string | null>(null);
// --- 移除 shortcutTriggeredInKeyDown 标志 ---
const focusSwitcherKeyboardListenerOptions: AddEventListenerOptions = { capture: true };

const suppressPlainAltDefault = (event: KeyboardEvent) => {
  if (!shouldSuppressFocusSwitcherKeyDefault(isFocusSwitcherHotkeyRoute.value, event.key, event.altKey)) return;
  event.preventDefault();
  event.stopPropagation();
};

onMounted(() => {
  // +++ 全局 Alt 键监听器 +++
  window.addEventListener('keydown', handleAltKeyDown, focusSwitcherKeyboardListenerOptions); // +++ 监听 keydown 设置状态 +++
  window.addEventListener('keyup', handleGlobalKeyUp, focusSwitcherKeyboardListenerOptions);   // +++ 监听 keyup 执行切换 +++
  
  // PWA Install Prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    debugLog('[App.vue] beforeinstallprompt event fired. Browser will handle install prompt.');
  });

  window.addEventListener('appinstalled', () => {
    debugLog('[App.vue] PWA was installed');
  });
  
});

// +++ 监听用户认证状态，登录后初始化收藏路径 +++
watch(isAuthenticated, (loggedIn) => {
  if (loggedIn) {
    favoritePathsStore.initializeFavoritePaths(t);
  }
}, { immediate: true });

// +++ 卸载钩子以移除监听器 +++
onUnmounted(() => {
  window.removeEventListener('keydown', handleAltKeyDown, focusSwitcherKeyboardListenerOptions); // +++ 移除 keydown 监听 +++
  window.removeEventListener('keyup', handleGlobalKeyUp, focusSwitcherKeyboardListenerOptions);   // +++ 移除 keyup 监听 +++
});


const normalizedRoutePath = computed(() => {
  const currentPath = route.path.replace(/\/+$/, '');
  return currentPath || '/';
});

const isFocusSwitcherHotkeyRoute = computed(() => shouldEnableFocusSwitcherHotkeys(normalizedRoutePath.value));
const isSettingsOverlayVisible = computed(() => route.name === 'Connections' && route.query.settings === '1');
const isAdminCenterOverlayVisible = computed(() => route.name === 'Connections' && route.query.admin === '1');
const shouldShowMainFocusSwitcherConfigurator = computed(() => (
  isFocusSwitcherVisible.value
  && (focusSwitcherConfiguratorSourceDocument.value === null || focusSwitcherConfiguratorSourceDocument.value === document)
));

const closeSettingsOverlay = () => {
  void router.push({ name: 'Connections' });
};

const closeAdminCenterOverlay = () => {
  void router.push({ name: 'Connections' });
};

// +++ 处理 Alt 键按下的事件处理函数，并记录快捷键 +++
const handleAltKeyDown = async (event: KeyboardEvent) => { // +++ 改为 async +++
  suppressPlainAltDefault(event);
  if (!isFocusSwitcherHotkeyRoute.value) return; // 只在工作区类路由下执行
  // 只在 Alt 键首次按下时设置状态
  if (event.key === 'Alt') {
    if (event.repeat) return;
    isAltPressed.value = true;
    altShortcutKey.value = null;
    // console.log('[App] Alt key pressed down.');
  } else if (
    (isAltPressed.value || (event.altKey && !event.ctrlKey && !event.metaKey))
    && !['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)
  ) {
    // 如果 Alt 正被按住，且按下了非修饰键 (移除 !shortcutTriggeredInKeyDown 检查)
    let key = event.key;
    if (key.length === 1) key = key.toUpperCase();

    if (/^[a-zA-Z0-9]$/.test(key)) {
        isAltPressed.value = true;
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
  suppressPlainAltDefault(event);
  if (!isFocusSwitcherHotkeyRoute.value) return; // 只在工作区类路由下执行
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

</script>

<template>
  
  <div id="app-container">
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
    <FileEditorOverlay v-if="shouldMountPopupFileEditor" :is-mobile="isMobile" />

    <SettingsView
      v-if="isSettingsOverlayVisible"
      is-dialog
      @close="closeSettingsOverlay"
    />

    <AdminCenterView
      v-if="isAdminCenterOverlayVisible"
      is-dialog
      @close="closeAdminCenterOverlay"
    />

    <!-- +++ 条件渲染焦点切换配置器 (使用 v-show 保持实例) +++ -->
    <FocusSwitcherConfigurator
      v-show="shouldShowMainFocusSwitcherConfigurator"
      :isVisible="shouldShowMainFocusSwitcherConfigurator"
      @close="focusSwitcherStore.toggleConfigurator(false)"
    />

    <!-- +++ 条件渲染 RDP 模态框 +++ -->
    <RemoteDesktopModal
      v-if="remoteDesktopFeatureAvailable && isRdpModalOpen"
      :connection="rdpConnectionInfo"
      @close="sessionStore.closeRdpModal()"
    />

    <!-- +++ 条件渲染 VNC 模态框 +++ -->
    <VncModal
      v-if="remoteDesktopFeatureAvailable && isVncModalOpen"
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

main {
  flex-grow: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
}

</style>

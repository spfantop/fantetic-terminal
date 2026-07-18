<script setup lang="ts">
import { RouterView, useRoute, useRouter } from 'vue-router';
import { onMounted, watch, computed, defineAsyncComponent } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from './stores/auth.store';
import { useDeviceDetection } from './composables/useDeviceDetection';
import { useGlobalOverlayStore } from './stores/globalOverlay.store';
import { useFavoritePathsStore } from './stores/favoritePaths.store';
import { storeToRefs } from 'pinia';
import UINotificationDisplay from './components/UINotificationDisplay.vue';
import ConfirmDialog from './components/common/ConfirmDialog.vue';
import { useDialogStore } from './stores/dialog.store';
import { debugLog } from './composables/useDebugLog';
import { isRemoteDesktopFeatureAvailable } from './utils/runtimeConfig';

const { t } = useI18n();
const remoteDesktopFeatureAvailable = isRemoteDesktopFeatureAvailable();
const isDesktopBuild = import.meta.env.VITE_FANTETIC_APP_MODE === 'electron';
const FileEditorOverlay = defineAsyncComponent(() => import('./components/FileEditorOverlay.vue'));
const SettingsView = defineAsyncComponent(() => import('./views/SettingsView.vue'));
const AdminCenterView = defineAsyncComponent(() => import('./views/AdminCenterView.vue'));
const RemoteDesktopModal = isDesktopBuild
  ? null
  : defineAsyncComponent(() => import('./components/RemoteDesktopModal.vue'));
const VncModal = isDesktopBuild
  ? null
  : defineAsyncComponent(() => import('./components/VncModal.vue'));
const authStore = useAuthStore();
const overlayStore = useGlobalOverlayStore();
const dialogStore = useDialogStore(); // +++ 实例化 DialogStore +++
const { state: dialogState } = storeToRefs(dialogStore); 
const favoritePathsStore = useFavoritePathsStore(); // +++ 实例化 favoritePathsStore +++
const { isAuthenticated } = storeToRefs(authStore);
const { popupFileInfo, isRdpModalOpen, rdpConnectionInfo, isVncModalOpen, vncConnectionInfo } = storeToRefs(overlayStore);
const shouldMountPopupFileEditor = computed(() => popupFileInfo.value !== null);
const { isMobile } = useDeviceDetection();

const route = useRoute();
const router = useRouter();

onMounted(() => {
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

const isSettingsOverlayVisible = computed(() => route.name === 'Connections' && route.query.settings === '1');
const isAdminCenterOverlayVisible = computed(() => route.name === 'Connections' && route.query.admin === '1');

const closeSettingsOverlay = () => {
  void router.push({ name: 'Connections' });
};

const closeAdminCenterOverlay = () => {
  void router.push({ name: 'Connections' });
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

    <!-- +++ 条件渲染 RDP 模态框 +++ -->
    <RemoteDesktopModal
      v-if="remoteDesktopFeatureAvailable && isRdpModalOpen"
      :connection="rdpConnectionInfo"
      @close="overlayStore.closeRdpModal()"
    />

    <!-- +++ 条件渲染 VNC 模态框 +++ -->
    <VncModal
      v-if="remoteDesktopFeatureAvailable && isVncModalOpen"
      :connection="vncConnectionInfo"
      @close="overlayStore.closeVncModal()"
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

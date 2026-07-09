<template>
  <div
    :class="[
      'settings-root text-foreground',
      props.isDialog ? 'settings-dialog-layer' : 'settings-page bg-background min-h-screen'
    ]"
    @click.self="handleBackdropClick"
  >
    <div
      ref="dialogShellRef"
      :class="['settings-shell', { 'settings-dialog-shell': props.isDialog }]"
      :style="props.isDialog ? dialogStyle : undefined"
      :role="props.isDialog ? 'dialog' : undefined"
      :aria-modal="props.isDialog ? 'true' : undefined"
      :aria-label="props.isDialog ? t('nav.settings') : undefined"
    >
      <span v-if="props.isDialog" class="settings-resize-hint" aria-hidden="true"></span>
      <aside class="settings-sidebar" aria-label="设置">
        <nav class="settings-nav">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            :class="['settings-nav-item', { active: activeTab === tab.key }]"
            @click="selectTab(tab.key)"
          >
            <i :class="tab.icon"></i>
            <span>{{ tab.label }}</span>
          </button>
        </nav>
      </aside>

      <section class="settings-content">
        <header class="settings-content-header">
          <div
            class="settings-content-title"
            :class="{ 'settings-drag-handle': props.isDialog }"
            @pointerdown="startDialogDrag"
          >
            <i :class="activeTabInfo.icon"></i>
            <h1>{{ activeTabInfo.label }}</h1>
          </div>
          <button
            v-if="props.isDialog"
            type="button"
            class="settings-close-button"
            :aria-label="t('common.close')"
            @click="closeDialog"
          >
            <i class="fas fa-xmark"></i>
          </button>
          <button
            v-if="!props.isDialog"
            type="button"
            class="settings-close-button"
            :aria-label="t('common.close')"
            @click="closePage"
          >
            <i class="fas fa-xmark"></i>
          </button>
        </header>

        <div v-if="settingsError" class="p-4 border-l-4 border-error bg-error/10 text-error rounded">
          {{ settingsError }}
        </div>

        <div v-else class="settings-content-body">
        <!-- Dashboard Tab Content -->
        <div v-if="activeTab === 'dashboard'">
          <DashboardView />
        </div>

        <!-- Security Tab Content -->
        <div v-if="activeTab === 'security'">
          <div v-if="settings" class="p-4 bg-background text-foreground">
            <div class="max-w-6xl mx-auto">
              <h2 class="text-xl font-semibold text-foreground mb-4 pb-2 border-b border-border">{{ $t('settings.category.security') }}</h2>
              <div class="space-y-6">
                <ChangePasswordForm />
                <hr class="border-border/50">
                <PasskeyManagement />
                <hr class="border-border/50">
                <TwoFactorAuthSettings />
                <hr class="border-border/50">
                <CaptchaSettingsForm />
              </div>
            </div>
          </div>
          <div v-else class="p-4 text-center text-muted-foreground">{{ $t('settings.loading', '加载中...') }}</div>
        </div>

        <!-- IP Control Tab Content -->
        <div v-if="activeTab === 'ipControl'">
          <div v-if="settings" class="p-4 bg-background text-foreground">
            <div class="max-w-6xl mx-auto space-y-6">
              <IpWhitelistSettings />
              <IpBlacklistSettings />
            </div>
          </div>
          <div v-else-if="!settings && activeTab === 'ipControl'" class="p-4 text-center text-muted-foreground">{{ $t('settings.loading', '加载中...') }}</div>
        </div>
        
        <!-- Workspace Tab Content -->
        <div v-if="activeTab === 'workspace'">
          <WorkspaceSettingsSection v-if="settings" />
          <div v-else class="p-4 text-center text-muted-foreground">{{ $t('settings.loading', '加载中...') }}</div>
        </div>

        <!-- AI Tab Content -->
        <div v-if="activeTab === 'ai'">
          <AISettingsSection />
        </div>

        <!-- System Tab Content -->
        <div v-if="activeTab === 'system'">
          <SystemSettingsSection v-if="settings" />
          <div v-else class="p-4 text-center text-muted-foreground">{{ $t('settings.loading', '加载中...') }}</div>
        </div>

        <!-- Data Management Tab Content -->
        <div v-if="activeTab === 'dataManagement'">
          <DataManagementSection v-if="settings" />
          <div v-else class="p-4 text-center text-muted-foreground">{{ $t('settings.loading', '加载中...') }}</div>
        </div>

        <!-- Audit Logs Tab Content -->
        <div v-if="activeTab === 'auditLogs'">
          <AuditLogView />
        </div>
        
        <!-- Appearance Tab Content -->
        <div v-if="activeTab === 'appearance'">
          <AppearanceSection v-if="settings" />
          <div v-else class="p-4 text-center text-muted-foreground">{{ $t('settings.loading', '加载中...') }}</div>
        </div>

        <!-- Proxies Tab Content -->
        <div v-if="activeTab === 'proxies'">
          <ProxiesView />
        </div>

        <!-- Notifications Tab Content -->
        <div v-if="activeTab === 'notifications'">
          <NotificationsView />
        </div>

        <!-- About Tab Content -->
        <div v-if="activeTab === 'about'">
          <AboutSection />
        </div>
      </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSettingsStore } from '../stores/settings.store';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import ChangePasswordForm from '../components/settings/ChangePasswordForm.vue';
import PasskeyManagement from '../components/settings/PasskeyManagement.vue';
import TwoFactorAuthSettings from '../components/settings/TwoFactorAuthSettings.vue';
import CaptchaSettingsForm from '../components/settings/CaptchaSettingsForm.vue';
import IpWhitelistSettings from '../components/settings/IpWhitelistSettings.vue';
import IpBlacklistSettings from '../components/settings/IpBlacklistSettings.vue';
import AboutSection from '../components/settings/AboutSection.vue';
import WorkspaceSettingsSection from '../components/settings/WorkspaceSettingsSection.vue';
import AISettingsSection from '../components/settings/AISettingsSection.vue';
import SystemSettingsSection from '../components/settings/SystemSettingsSection.vue';
import DataManagementSection from '../components/settings/DataManagementSection.vue';
import AppearanceSection from '../components/settings/AppearanceSection.vue';
import ProxiesView from './ProxiesView.vue';
import NotificationsView from './NotificationsView.vue';
import DashboardView from './DashboardView.vue';
import AuditLogView from './AuditLogView.vue';
import { createSettingsTabs, type SettingsTabKey } from '../utils/settingsTabs';
import { useResizable } from '../composables/useResizable';
import { isAccountFeatureAvailable } from '../utils/runtimeConfig';

const props = withDefaults(defineProps<{
  isDialog?: boolean;
}>(), {
  isDialog: false,
});

const emit = defineEmits<{
  close: [];
}>();

const settingsStore = useSettingsStore();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const accountFeatureAvailable = isAccountFeatureAvailable();

// Define tabs for settings sections
const tabs = ref(createSettingsTabs(t).filter(tab => accountFeatureAvailable || tab.key !== 'security'));
const isSettingsTabKey = (value: unknown): value is SettingsTabKey => (
  typeof value === 'string' && tabs.value.some(tab => tab.key === value)
);
const readRouteTab = (): SettingsTabKey | null => {
  const tabQuery = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab;
  return isSettingsTabKey(tabQuery) ? tabQuery : null;
};
const activeTab = ref<SettingsTabKey>(props.isDialog ? tabs.value[0].key : (readRouteTab() || tabs.value[0].key));
const activeTabInfo = computed(() => tabs.value.find(tab => tab.key === activeTab.value) || tabs.value[0]);
const dialogShellRef = ref<HTMLElement | null>(null);
const readSettingsWindow = () => dialogShellRef.value?.ownerDocument.defaultView ?? window;
const isMobileViewport = computed(() => readSettingsWindow().innerWidth <= 768);
const { width: dialogWidth, height: dialogHeight } = useResizable(dialogShellRef, {
  minWidth: 640,
  minHeight: 420,
  maxWidth: window.innerWidth - 24,
  maxHeight: window.innerHeight - 24,
});
const dialogPosition = ref<{ left: number; top: number } | null>(null);
const dialogDragState = ref<{
  pointerId: number;
  startX: number;
  startY: number;
  initialLeft: number;
  initialTop: number;
} | null>(null);
const dialogStyle = computed(() => {
  if (isMobileViewport.value) {
    return {
      width: 'min(100%, calc(100dvw - 2rem))',
      maxWidth: 'calc(100dvw - 2rem)',
      height: 'min(90dvh, calc(100dvh - 2rem))',
      maxHeight: 'calc(100dvh - 2rem)',
    };
  }

  const style: Record<string, string | undefined> = {
    width: dialogWidth.value ? `${dialogWidth.value}px` : undefined,
    height: dialogHeight.value ? `${dialogHeight.value}px` : undefined,
  };

  if (!dialogPosition.value) return style;

  return {
    ...style,
    left: `${dialogPosition.value.left}px`,
    top: `${dialogPosition.value.top}px`,
    margin: '0',
    transform: 'none',
  };
});

// --- Reactive state from store ---
// 使用 storeToRefs 获取响应式 getter，包括 language
const {
    settings,
    error: settingsError,
} = storeToRefs(settingsStore);


const closeDialog = () => {
  emit('close');
};

const closePage = () => {
  void router.push({ name: 'Connections' });
};

const handleBackdropClick = () => {
  if (props.isDialog) {
    closeDialog();
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  if (props.isDialog && event.key === 'Escape') {
    closeDialog();
  }
};

const selectTab = (tabKey: SettingsTabKey) => {
  activeTab.value = tabKey;
  if (props.isDialog) return;

  void router.replace({
    query: {
      ...route.query,
      tab: tabKey,
    },
  });
};

watch(() => route.query.tab, () => {
  if (props.isDialog) return;
  const routeTab = readRouteTab();
  if (routeTab) {
    activeTab.value = routeTab;
  }
});

const clampDialogPosition = (left: number, top: number) => {
  const dialogEl = dialogShellRef.value;
  if (!dialogEl) return { left, top };

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rect = dialogEl.getBoundingClientRect();
  const padding = 12;
  const maxLeft = Math.max(padding, viewportWidth - rect.width - padding);
  const maxTop = Math.max(padding, viewportHeight - rect.height - padding);

  return {
    left: Math.min(maxLeft, Math.max(padding, left)),
    top: Math.min(maxTop, Math.max(padding, top)),
  };
};

const startDialogDrag = (event: PointerEvent) => {
  if (!props.isDialog || event.button !== 0) return;

  const target = event.target;
  if (target instanceof HTMLElement && target.closest('button, a, input, textarea, select')) {
    return;
  }

  const dialogEl = dialogShellRef.value;
  if (!dialogEl) return;

  const rect = dialogEl.getBoundingClientRect();
  dialogPosition.value = { left: rect.left, top: rect.top };
  dialogDragState.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    initialLeft: rect.left,
    initialTop: rect.top,
  };

  event.preventDefault();
  dialogEl.setPointerCapture?.(event.pointerId);
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'move';
  window.addEventListener('pointermove', handleDialogDrag);
  window.addEventListener('pointerup', stopDialogDrag);
  window.addEventListener('pointercancel', stopDialogDrag);
};

const handleDialogDrag = (event: PointerEvent) => {
  const dragState = dialogDragState.value;
  if (!dragState || event.pointerId !== dragState.pointerId) return;

  const nextLeft = dragState.initialLeft + event.clientX - dragState.startX;
  const nextTop = dragState.initialTop + event.clientY - dragState.startY;
  dialogPosition.value = clampDialogPosition(nextLeft, nextTop);
};

const stopDialogDrag = (event?: PointerEvent) => {
  const dialogEl = dialogShellRef.value;
  if (event && dialogDragState.value?.pointerId === event.pointerId) {
    dialogEl?.releasePointerCapture?.(event.pointerId);
  }

  dialogDragState.value = null;
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
  window.removeEventListener('pointermove', handleDialogDrag);
  window.removeEventListener('pointerup', stopDialogDrag);
  window.removeEventListener('pointercancel', stopDialogDrag);
};

onMounted(async () => {
  if (props.isDialog) {
    window.addEventListener('keydown', handleKeydown);
  }
  // await fetchIpBlacklist(); // REMOVED - Handled by useIpBlacklist.ts onMounted
  await settingsStore.loadCaptchaSettings(); // <-- Load CAPTCHA settings
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  stopDialogDrag();
});

</script>

<style scoped>
.settings-root {
  color: var(--text-color);
}

.settings-page {
  display: flex;
  min-height: 0;
  height: 100%;
  padding: 1rem;
}

.settings-dialog-layer {
  position: fixed;
  inset: 0;
  z-index: 1050;
  padding: clamp(1rem, 2vw, 2rem);
  background: transparent;
  pointer-events: none;
  overflow: auto;
}

.settings-shell {
  display: flex;
  width: min(100%, 82rem);
  height: calc(100dvh - 2rem);
  min-height: 0;
  margin: 0 auto;
  border: 1px solid var(--border-color);
  border-radius: 0.75rem;
  background: var(--app-bg-color);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
  overflow: hidden;
  min-width: 0;
}

.settings-dialog-shell {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(58rem, calc(100vw - 2rem));
  height: min(42rem, calc(100dvh - 2rem));
  min-height: min(24rem, calc(100dvh - 2rem));
  max-height: calc(100dvh - 2rem);
  margin: 0;
  border-radius: 0.85rem;
  box-shadow: 0 24px 72px rgba(15, 23, 42, 0.22);
  pointer-events: auto;
  transform: translate(-50%, -50%);
}

.settings-resize-hint {
  position: absolute;
  right: 0.35rem;
  bottom: 0.35rem;
  width: 0.8rem;
  height: 0.8rem;
  border-right: 2px solid color-mix(in srgb, var(--text-color-secondary) 55%, transparent);
  border-bottom: 2px solid color-mix(in srgb, var(--text-color-secondary) 55%, transparent);
  pointer-events: none;
}

.settings-sidebar {
  width: 16rem;
  min-width: 16rem;
  min-height: 0;
  border-right: 1px solid var(--border-color);
  background: var(--header-bg-color);
  user-select: none;
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 100%;
  min-height: 0;
  padding: 0.75rem;
  overflow-y: auto;
}

.settings-nav-item {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.75rem;
  padding: 0.65rem 0.9rem;
  border: 1px solid transparent;
  border-radius: 0.65rem;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.settings-nav-item i {
  width: 1.25rem;
  color: currentColor;
  font-size: 1rem;
  text-align: center;
}

.settings-nav-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.95rem;
  font-weight: 500;
}

.settings-nav-item:hover,
.settings-nav-item:focus-visible {
  border-color: var(--border-color);
  color: var(--link-hover-color);
}

.settings-nav-item.active {
  border-color: color-mix(in srgb, var(--link-active-color) 42%, var(--border-color));
  background: var(--nav-item-active-bg-color);
  color: var(--link-active-color);
}

.settings-content {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: var(--app-bg-color);
}

.settings-content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.9rem;
  flex-shrink: 0;
  padding: 1.1rem 1.5rem 0.9rem;
  border-bottom: 1px solid var(--border-color);
  background: var(--app-bg-color);
}

.settings-content-title {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 0.9rem;
}

.settings-drag-handle {
  flex: 1;
  cursor: move;
  user-select: none;
}

.settings-content-title i {
  width: 2.25rem;
  height: 2.25rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.65rem;
  background: var(--nav-item-active-bg-color);
  color: var(--link-active-color);
  font-size: 1.15rem;
}

.settings-content-title h1 {
  margin: 0;
  color: var(--text-color);
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1.2;
}

.settings-close-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  flex-shrink: 0;
  border: 1px solid transparent;
  border-radius: 0.65rem;
  background: transparent;
  color: var(--text-color-secondary);
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.settings-close-button:hover,
.settings-close-button:focus-visible {
  border-color: var(--border-color);
  background: var(--nav-item-active-bg-color);
  color: var(--text-color);
}

.settings-close-button i {
  font-size: 1rem;
  line-height: 1;
}

.settings-content-body {
  flex: 1;
  min-height: 0;
  padding: 1rem 1.5rem 1.5rem;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

@media (max-width: 768px) {
  .settings-page {
    padding: 0;
  }

  .settings-shell {
    height: 100dvh;
    min-height: 0;
    border: 0;
    border-radius: 0;
    flex-direction: column;
  }

  .settings-dialog-layer {
    padding: 1rem;
  }

  .settings-dialog-shell {
    left: 50%;
    top: 50%;
    width: min(100%, calc(100dvw - 2rem));
    height: min(90dvh, calc(100dvh - 2rem));
    min-height: min(20rem, 90dvh);
    max-height: calc(100dvh - 2rem);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    overflow: hidden;
  }

  .settings-sidebar {
    width: 100%;
    min-width: 0;
    min-height: auto;
    flex-shrink: 0;
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
  }

  .settings-nav {
    flex-direction: row;
    height: auto;
    padding: 0.5rem;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .settings-nav-item {
    width: auto;
    flex-shrink: 0;
    padding: 0.55rem 0.75rem;
  }

  .settings-content-header {
    padding: 0.9rem 1rem 0.75rem;
  }

  .settings-content-title h1 {
    font-size: 1.25rem;
  }

  .settings-content-body {
    padding: 0.75rem 1rem 1rem;
  }
}
</style>


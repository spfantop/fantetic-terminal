import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '../../utils/apiClient';
import { AI_REQUEST_TIMEOUT_MS } from '../../utils/aiConstants';
import { useAISettingsStore } from '../../stores/aiSettings.store';
import { useUiNotificationsStore } from '../../stores/uiNotifications.store';
import type { NL2CMDRequest, NL2CMDResponse } from '../../types/nl2cmd.types';

export interface RemoteSystemInfo {
  osType: string;
  shellType: string;
  currentPath?: string;
}

export function useNL2CMD() {
  const aiSettingsStore = useAISettingsStore();
  const notificationsStore = useUiNotificationsStore();
  const { t } = useI18n();
  const query = ref('');
  const isLoading = ref(false);
  const lastResponse = ref<NL2CMDResponse | null>(null);
  const lastError = ref('');
  const remoteSystemInfo = ref<RemoteSystemInfo>({
    osType: 'Linux',
    shellType: 'bash',
    currentPath: '~',
  });

  onMounted(() => {
    aiSettingsStore.ensureLoaded().catch(() => {
      notificationsStore.showWarning(t('ai.nl2cmd.settingsLoadFailed'));
    });
  });

  const isAIEnabled = computed(() => aiSettingsStore.settings.enabled);

  function setRemoteSystemInfo(info: Partial<RemoteSystemInfo>) {
    remoteSystemInfo.value = {
      ...remoteSystemInfo.value,
      ...info,
    };
  }

  async function generateCommand(): Promise<string | null> {
    if (!query.value.trim()) {
      notificationsStore.showWarning(t('ai.nl2cmd.emptyPrompt'));
      return null;
    }

    isLoading.value = true;
    lastResponse.value = null;
    lastError.value = '';
    try {
      const request: NL2CMDRequest = {
        query: query.value.trim(),
        osType: remoteSystemInfo.value.osType,
        shellType: remoteSystemInfo.value.shellType,
        currentPath: remoteSystemInfo.value.currentPath,
      };
      const response = await apiClient.post<NL2CMDResponse>('/ai/nl2cmd', request, {
        timeout: AI_REQUEST_TIMEOUT_MS,
      });
      lastResponse.value = response.data;

      if (!response.data.success || !response.data.command) {
        lastError.value = response.data.error || t('ai.nl2cmd.generateFailed');
        notificationsStore.showError(lastError.value);
        return null;
      }

      if (response.data.warning) {
        notificationsStore.showWarning(t('ai.nl2cmd.dangerWarning', { warning: response.data.warning }));
      } else {
        notificationsStore.showSuccess(t('ai.nl2cmd.generated'));
      }
      return response.data.command;
    } catch (error: any) {
      const message = error.response?.data?.error || error.message || t('ai.nl2cmd.generateFailed');
      lastResponse.value = error.response?.data || null;
      lastError.value = message;
      notificationsStore.showError(message);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  return {
    query,
    isLoading,
    isAIEnabled,
    lastResponse,
    lastError,
    remoteSystemInfo,
    setRemoteSystemInfo,
    generateCommand,
  };
}

import { computed, onMounted, ref } from 'vue';
import axios from 'axios';
import { useI18n } from 'vue-i18n';
import { debugLog } from '../useDebugLog';
import apiClient from '../../utils/apiClient';

const normalizeVersion = (version: string) => version.trim().replace(/^v/i, '');

export function useVersionCheck() {
  const { t } = useI18n();
  const appVersion = ref('');
  const latestVersion = ref<string | null>(null);
  const isCheckingVersion = ref(false);
  const versionCheckError = ref<string | null>(null);

  const isUpdateAvailable = computed(() => {
    if (!appVersion.value || !latestVersion.value) return false;
    return normalizeVersion(appVersion.value) !== normalizeVersion(latestVersion.value);
  });

  const loadAppVersion = async () => {
    try {
      const response = await axios.get('/VERSION', { responseType: 'text' });
      appVersion.value = String(response.data).trim();
    } catch (error) {
      debugLog('[Version] 加载本地版本失败:', error);
      appVersion.value = t('settings.about.unknownVersion', '未知版本');
    }
  };

  const checkLatestVersion = async () => {
    isCheckingVersion.value = true;
    versionCheckError.value = null;
    latestVersion.value = null;
    try {
      const response = await apiClient.get('/version/remote');
      const version = response.data?.version;
      if (typeof version !== 'string' || !version.trim()) {
        throw new Error('Empty remote version');
      }
      latestVersion.value = version.trim();
    } catch (error) {
      debugLog('[Version] 检查远程版本失败:', error);
      versionCheckError.value = t('settings.about.error.checkFailed');
    } finally {
      isCheckingVersion.value = false;
    }
  };

  onMounted(() => {
    void loadAppVersion();
  });

  return {
    appVersion,
    latestVersion,
    isCheckingVersion,
    versionCheckError,
    isUpdateAvailable,
    checkLatestVersion,
  };
}

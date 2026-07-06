import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../utils/apiClient';
import {
  AI_PROVIDER_DEFAULTS,
  AI_REQUEST_TIMEOUT_MS,
  DEFAULT_OPENAI_BASE_URL,
} from '../utils/aiConstants';
import type { AISettings, AISettingsResponse, AITestResponse } from '../types/nl2cmd.types';

const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  provider: 'openai',
  baseUrl: DEFAULT_OPENAI_BASE_URL,
  apiKey: '',
  model: AI_PROVIDER_DEFAULTS.openai.model,
  openaiEndpoint: AI_PROVIDER_DEFAULTS.openai.endpoint,
  rateLimitEnabled: true,
};

export const useAISettingsStore = defineStore('aiSettings', () => {
  const settings = ref<AISettings>({ ...DEFAULT_AI_SETTINGS });
  const isLoading = ref(false);
  const isTesting = ref(false);
  const hasLoaded = ref(false);

  async function loadSettings(): Promise<void> {
    isLoading.value = true;
    try {
      const response = await apiClient.get<AISettingsResponse>('/ai/settings');
      if (response.data.success && response.data.settings) {
        settings.value = response.data.settings;
      }
      hasLoaded.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (hasLoaded.value) return;
    await loadSettings();
  }

  async function saveSettings(nextSettings: AISettings): Promise<void> {
    isLoading.value = true;
    try {
      const response = await apiClient.post<AISettingsResponse>('/ai/settings', nextSettings);
      if (!response.data.success || !response.data.settings) {
        throw new Error(response.data.message || 'Failed to save AI settings');
      }
      settings.value = response.data.settings;
      hasLoaded.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  async function testConnection(testSettings: AISettings): Promise<{ success: boolean; error?: string }> {
    isTesting.value = true;
    try {
      const response = await apiClient.post<AITestResponse>('/ai/test', testSettings, {
        timeout: AI_REQUEST_TIMEOUT_MS,
      });
      return { success: response.data.success, error: response.data.error };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || error.response?.data?.message || error.message,
      };
    } finally {
      isTesting.value = false;
    }
  }

  return {
    settings,
    isLoading,
    isTesting,
    hasLoaded,
    loadSettings,
    ensureLoaded,
    saveSettings,
    testConnection,
  };
});

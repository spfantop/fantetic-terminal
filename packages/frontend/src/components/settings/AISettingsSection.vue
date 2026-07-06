<template>
  <div class="p-4 bg-background text-foreground">
    <div class="max-w-6xl mx-auto">
      <h2 class="text-xl font-semibold text-foreground mb-4 pb-2 border-b border-border">
        {{ t('settings.ai.title') }}
      </h2>

      <form class="space-y-6" @submit.prevent="handleSave">
        <div class="settings-section-content space-y-4">
          <div class="flex items-center">
            <input
              id="aiEnabled"
              v-model="localSettings.enabled"
              type="checkbox"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label for="aiEnabled" class="text-sm text-foreground cursor-pointer select-none">
              {{ t('settings.ai.enableLabel') }}
            </label>
          </div>

          <div>
            <label for="aiProvider" class="block text-sm font-medium text-text-secondary mb-1">
              {{ t('settings.ai.provider') }}
            </label>
            <select
              id="aiProvider"
              v-model="localSettings.provider"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              @change="handleProviderChange"
            >
              <option value="openai">OpenAI Compatible</option>
              <option value="claude">Anthropic Claude</option>
            </select>
          </div>

          <div v-if="localSettings.provider === 'openai'">
            <label for="aiEndpoint" class="block text-sm font-medium text-text-secondary mb-1">
              {{ t('settings.ai.endpoint') }}
            </label>
            <select
              id="aiEndpoint"
              v-model="localSettings.openaiEndpoint"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            >
              <option v-for="option in OPENAI_ENDPOINT_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>

          <div>
            <label for="aiBaseUrl" class="block text-sm font-medium text-text-secondary mb-1">
              {{ t('settings.ai.baseUrl') }}
            </label>
            <input
              id="aiBaseUrl"
              v-model="localSettings.baseUrl"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              :placeholder="baseUrlPlaceholder"
            />
            <p v-if="localSettings.provider === 'openai'" class="text-xs text-text-secondary mt-1">
              {{ t('settings.ai.oneApiHint') }}
            </p>
          </div>

          <div>
            <label for="aiApiKey" class="block text-sm font-medium text-text-secondary mb-1">
              {{ t('settings.ai.apiKey') }}
            </label>
            <input
              id="aiApiKey"
              v-model="localSettings.apiKey"
              :type="showApiKey ? 'text' : 'password'"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              placeholder="sk-..."
            />
            <p v-if="localSettings.apiKey.includes('...')" class="text-xs text-warning mt-1">
              {{ t('settings.ai.maskedKeyHint') }}
            </p>
          </div>

          <div>
            <label for="aiModel" class="block text-sm font-medium text-text-secondary mb-1">
              {{ t('settings.ai.model') }}
            </label>
            <input
              id="aiModel"
              v-model="localSettings.model"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              :placeholder="modelPlaceholder"
            />
          </div>

          <div class="flex items-center">
            <input
              id="showAiKey"
              v-model="showApiKey"
              type="checkbox"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label for="showAiKey" class="text-sm text-foreground cursor-pointer select-none">
              {{ t('settings.ai.showKey') }}
            </label>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <button
              type="submit"
              :disabled="aiSettingsStore.isLoading"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ aiSettingsStore.isLoading ? t('common.saving') : t('common.save') }}
            </button>
            <button
              type="button"
              :disabled="aiSettingsStore.isTesting"
              class="px-4 py-2 bg-background border border-border text-foreground rounded-md shadow-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              @click="handleTest"
            >
              {{ aiSettingsStore.isTesting ? t('settings.ai.testing') : t('settings.ai.test') }}
            </button>
          </div>
          <p v-if="statusMessage" :class="['text-sm', statusSuccess ? 'text-success' : 'text-error']">
            {{ statusMessage }}
          </p>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAISettingsStore } from '../../stores/aiSettings.store';
import {
  AI_PROVIDER_DEFAULTS,
  DEFAULT_CLAUDE_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  OPENAI_ENDPOINT_OPTIONS,
} from '../../utils/aiConstants';
import type { AISettings } from '../../types/nl2cmd.types';

const { t } = useI18n();
const aiSettingsStore = useAISettingsStore();
const showApiKey = ref(false);
const statusMessage = ref('');
const statusSuccess = ref(false);

const localSettings = ref<AISettings>({
  enabled: false,
  provider: 'openai',
  baseUrl: DEFAULT_OPENAI_BASE_URL,
  apiKey: '',
  model: AI_PROVIDER_DEFAULTS.openai.model,
  openaiEndpoint: AI_PROVIDER_DEFAULTS.openai.endpoint,
  rateLimitEnabled: true,
});

const baseUrlPlaceholder = computed(() =>
  localSettings.value.provider === 'claude' ? DEFAULT_CLAUDE_BASE_URL : DEFAULT_OPENAI_BASE_URL,
);

const modelPlaceholder = computed(() =>
  localSettings.value.provider === 'claude'
    ? AI_PROVIDER_DEFAULTS.claude.model
    : AI_PROVIDER_DEFAULTS.openai.model,
);

function setStatus(message: string, success: boolean) {
  statusMessage.value = message;
  statusSuccess.value = success;
}

onMounted(async () => {
  try {
    await aiSettingsStore.loadSettings();
    localSettings.value = { ...aiSettingsStore.settings };
  } catch {
    setStatus(t('settings.ai.loadFailed'), false);
  }
});

watch(
  () => aiSettingsStore.settings,
  (settings) => {
    localSettings.value = { ...settings };
  },
  { deep: true },
);

function handleProviderChange() {
  if (localSettings.value.provider === 'claude') {
    localSettings.value.baseUrl = DEFAULT_CLAUDE_BASE_URL;
    localSettings.value.model = AI_PROVIDER_DEFAULTS.claude.model;
    localSettings.value.openaiEndpoint = undefined;
    return;
  }
  localSettings.value.baseUrl = DEFAULT_OPENAI_BASE_URL;
  localSettings.value.model = AI_PROVIDER_DEFAULTS.openai.model;
  localSettings.value.openaiEndpoint = AI_PROVIDER_DEFAULTS.openai.endpoint;
}

function validateLocalSettings(): boolean {
  if (!localSettings.value.baseUrl.trim() || !localSettings.value.model.trim()) {
    setStatus(t('settings.ai.required'), false);
    return false;
  }
  if (localSettings.value.enabled && !localSettings.value.apiKey.trim()) {
    setStatus(t('settings.ai.apiKeyRequired'), false);
    return false;
  }
  return true;
}

async function handleSave() {
  if (!validateLocalSettings()) return;
  try {
    await aiSettingsStore.saveSettings(localSettings.value);
    setStatus(t('settings.ai.saveSuccess'), true);
  } catch {
    setStatus(t('settings.ai.saveFailed'), false);
  }
}

async function handleTest() {
  if (!validateLocalSettings()) return;
  const result = await aiSettingsStore.testConnection(localSettings.value);
  setStatus(result.success ? t('settings.ai.testSuccess') : result.error || t('settings.ai.testFailed'), result.success);
}
</script>

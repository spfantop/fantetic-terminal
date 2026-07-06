import { DEFAULT_AI_SETTINGS } from './nl2cmd.constants';
import type { AISettings, OpenAIEndpoint } from './nl2cmd.types';

const OPENAI_ENDPOINTS = new Set<OpenAIEndpoint>(['/chat/completions', '/responses']);

function normalizeOpenAIEndpoint(value: unknown): OpenAIEndpoint {
  if (value === 'chat/completions') return '/chat/completions';
  if (value === 'responses') return '/responses';
  if (typeof value === 'string' && OPENAI_ENDPOINTS.has(value as OpenAIEndpoint)) {
    return value as OpenAIEndpoint;
  }
  return DEFAULT_AI_SETTINGS.openaiEndpoint;
}

export function normalizeAISettings(input: Partial<AISettings> | null | undefined): AISettings {
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : DEFAULT_AI_SETTINGS.enabled,
    provider: input?.provider === 'claude' ? 'claude' : DEFAULT_AI_SETTINGS.provider,
    baseUrl: typeof input?.baseUrl === 'string' && input.baseUrl.trim()
      ? input.baseUrl.trim()
      : DEFAULT_AI_SETTINGS.baseUrl,
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey : DEFAULT_AI_SETTINGS.apiKey,
    model: typeof input?.model === 'string' && input.model.trim()
      ? input.model.trim()
      : DEFAULT_AI_SETTINGS.model,
    openaiEndpoint: normalizeOpenAIEndpoint(input?.openaiEndpoint),
    rateLimitEnabled: typeof input?.rateLimitEnabled === 'boolean'
      ? input.rateLimitEnabled
      : DEFAULT_AI_SETTINGS.rateLimitEnabled,
  };
}

export function isMaskedApiKey(apiKey: string): boolean {
  return apiKey.includes('...');
}

export function applySavedAISettingsPatch(
  existing: AISettings | null | undefined,
  patch: Partial<AISettings>,
): AISettings {
  const normalizedExisting = normalizeAISettings(existing);
  const normalizedPatch = normalizeAISettings({
    ...normalizedExisting,
    ...patch,
  });

  if (patch.apiKey !== undefined && isMaskedApiKey(patch.apiKey)) {
    normalizedPatch.apiKey = normalizedExisting.apiKey;
  }

  if (normalizedPatch.provider === 'claude') {
    normalizedPatch.openaiEndpoint = undefined;
  }

  return normalizedPatch;
}

export function maskAISettingsForClient(settings: AISettings): AISettings {
  if (!settings.apiKey) {
    return { ...settings, apiKey: '' };
  }

  return {
    ...settings,
    apiKey: `${settings.apiKey.slice(0, 8)}...`,
  };
}

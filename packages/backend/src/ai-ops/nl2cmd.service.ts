import axios, { AxiosError } from 'axios';
import i18next from '../i18n';
import { settingsRepository } from '../settings/settings.repository';
import { decrypt, encrypt } from '../utils/crypto';
import { AI_SETTINGS_KEY, DEFAULT_AI_SETTINGS, NL2CMD_CONFIG } from './nl2cmd.constants';
import {
  applySavedAISettingsPatch,
  maskAISettingsForClient,
  normalizeAISettings,
} from './ai-settings.helpers';
import {
  buildNL2CMDPrompt,
  cleanCommandOutput,
  detectDangerousCommand,
  isHtmlResponse,
  readProviderText,
  sanitizeUserInput,
  validateBaseUrl,
} from './nl2cmd.helpers';
import type {
  AISettings,
  ClaudeResponse,
  NL2CMDRequest,
  NL2CMDResponse,
  OpenAIChatResponse,
  OpenAIResponsesResponse,
  ProviderResult,
} from './nl2cmd.types';

interface StoredAISettings extends Omit<AISettings, 'apiKey'> {
  encryptedApiKey?: string;
  apiKey?: string;
}

export function aiMessage(key: string, options?: Record<string, unknown>): string {
  return i18next.t(`ai.${key}`, options);
}

export function translateAIError(error: unknown, fallbackKey = 'generateFailed'): string {
  if (error instanceof Error) {
    if (error.message.startsWith('ai.')) {
      return i18next.t(error.message);
    }
    return error.message;
  }
  return aiMessage(fallbackKey);
}

async function retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= NL2CMD_CONFIG.MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (
        attempt < NL2CMD_CONFIG.MAX_RETRY_ATTEMPTS &&
        axios.isAxiosError(error) &&
        error.response?.status === 429
      ) {
        const delay = NL2CMD_CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function readStoredApiKey(stored: StoredAISettings): string {
  if (stored.encryptedApiKey) {
    return decrypt(stored.encryptedApiKey);
  }
  return stored.apiKey || '';
}

export async function getAISettings(): Promise<AISettings> {
  const raw = await settingsRepository.getSetting(AI_SETTINGS_KEY);
  if (!raw) {
    return normalizeAISettings(DEFAULT_AI_SETTINGS);
  }

  try {
    const stored = JSON.parse(raw) as StoredAISettings;
    return normalizeAISettings({
      ...stored,
      apiKey: readStoredApiKey(stored),
    });
  } catch (error) {
    console.error('[AI] 读取 AI 配置失败:', error);
    return normalizeAISettings(DEFAULT_AI_SETTINGS);
  }
}

export async function getMaskedAISettings(): Promise<AISettings> {
  return maskAISettingsForClient(await getAISettings());
}

export async function saveAISettings(patch: Partial<AISettings>): Promise<AISettings> {
  const existing = await getAISettings();
  const next = applySavedAISettingsPatch(existing, patch);
  validateAISettings(next);

  const stored: StoredAISettings = {
    enabled: next.enabled,
    provider: next.provider,
    baseUrl: next.baseUrl,
    encryptedApiKey: next.apiKey ? encrypt(next.apiKey) : '',
    model: next.model,
    openaiEndpoint: next.openaiEndpoint,
    rateLimitEnabled: next.rateLimitEnabled,
  };

  await settingsRepository.setSetting(AI_SETTINGS_KEY, JSON.stringify(stored));
  return maskAISettingsForClient(next);
}

export function validateAISettings(settings: AISettings): void {
  if (!['openai', 'claude'].includes(settings.provider)) {
    throw new Error('ai.unsupportedProvider');
  }
  validateBaseUrl(settings.baseUrl);
  if (!settings.model.trim()) {
    throw new Error('ai.modelRequired');
  }
  if (settings.enabled && !settings.apiKey.trim()) {
    throw new Error('ai.apiKeyRequired');
  }
}

function buildErrorMessage(error: AxiosError): string {
  if (error.code === 'ECONNABORTED' && error.config?.timeout) {
    return aiMessage('timeout', { timeout: error.config.timeout });
  }

  const data = error.response?.data as { error?: { message?: string }; message?: string } | undefined;
  const status = error.response?.status;
  switch (status) {
    case 400:
      return aiMessage('requestBadModel');
    case 401:
      return aiMessage('invalidApiKey');
    case 403:
      return aiMessage('permissionDenied');
    case 404:
      return aiMessage('endpointNotFound');
    case 429:
      return `${aiMessage('rateLimited')}${data?.error?.message ? `: ${data.error.message}` : ''}`;
    case 500:
    case 502:
    case 503:
      return aiMessage('serviceUnavailable');
    default:
      if (error.response) {
        return `API 错误 (${status}): ${data?.error?.message || data?.message || JSON.stringify(error.response.data)}`;
      }
      if (error.request) {
        return aiMessage('connectFailed');
      }
      return error.message || aiMessage('requestConfigError');
  }
}

function openAIEndpointUrl(config: AISettings): string {
  const endpoint = config.openaiEndpoint || DEFAULT_AI_SETTINGS.openaiEndpoint;
  return `${config.baseUrl.replace(/\/$/, '')}${endpoint}`;
}

function assertProviderJsonResponse(data: unknown, contentType: unknown): void {
  const normalizedContentType = typeof contentType === 'string' ? contentType.toLowerCase() : '';
  if (normalizedContentType.includes('text/html') || isHtmlResponse(data)) {
    throw new Error('ai.htmlResponse');
  }
}

async function callOpenAI(config: AISettings, prompt: string): Promise<ProviderResult> {
  const endpointUrl = openAIEndpointUrl(config);
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };

  if (endpointUrl.includes('/responses')) {
    return retryWithBackoff(async () => {
      const response = await axios.post<OpenAIResponsesResponse>(
        endpointUrl,
        {
          model: config.model,
          input: prompt,
          max_output_tokens: NL2CMD_CONFIG.MAX_OUTPUT_TOKENS,
          temperature: NL2CMD_CONFIG.TEMPERATURE,
        },
        { headers, timeout: NL2CMD_CONFIG.REQUEST_TIMEOUT_MS },
      );
      assertProviderJsonResponse(response.data, response.headers['content-type']);

      const outputText = response.data.output_text || response.data.output
        ?.flatMap((item) => item.content || [])
        .map((content) => readProviderText(content))
        .join('') || readProviderText(response.data);
      return { command: (outputText || '').trim(), usage: response.data.usage };
    });
  }

  return retryWithBackoff(async () => {
    const response = await axios.post<OpenAIChatResponse>(
      endpointUrl,
      {
        model: config.model,
        messages: [
          {
            role: 'system',
            content: '你是一个专业的命令行助手，专门把自然语言转换为精确的命令行指令。',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: NL2CMD_CONFIG.MAX_OUTPUT_TOKENS,
        temperature: NL2CMD_CONFIG.TEMPERATURE,
      },
      { headers, timeout: NL2CMD_CONFIG.REQUEST_TIMEOUT_MS },
    );
    assertProviderJsonResponse(response.data, response.headers['content-type']);

    return {
      command: readProviderText(response.data.choices?.[0]?.message?.content) || readProviderText(response.data),
      usage: response.data.usage,
    };
  });
}

async function callClaude(config: AISettings, prompt: string): Promise<ProviderResult> {
  const endpointUrl = `${config.baseUrl.replace(/\/$/, '')}/messages`;
  return retryWithBackoff(async () => {
    const response = await axios.post<ClaudeResponse>(
      endpointUrl,
      {
        model: config.model,
        max_tokens: NL2CMD_CONFIG.MAX_OUTPUT_TOKENS,
        temperature: NL2CMD_CONFIG.TEMPERATURE,
        system: '你是一个专业的命令行助手，专门把自然语言转换为精确的命令行指令。',
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: NL2CMD_CONFIG.REQUEST_TIMEOUT_MS,
      },
    );
    assertProviderJsonResponse(response.data, response.headers['content-type']);

    return {
      command: readProviderText(response.data.content),
      usage: response.data.usage,
    };
  });
}

export async function generateCommand(request: NL2CMDRequest): Promise<NL2CMDResponse> {
  const query = sanitizeUserInput(request.query || '');
  if (!query) {
    return { success: false, error: aiMessage('queryRequired') };
  }

  const settings = await getAISettings();
  if (!settings.enabled || !settings.apiKey) {
    return { success: false, error: aiMessage('disabled') };
  }

  try {
    validateAISettings(settings);
    const prompt = buildNL2CMDPrompt({ ...request, query });
    const result = settings.provider === 'claude'
      ? await callClaude(settings, prompt)
      : await callOpenAI(settings, prompt);
    const command = cleanCommandOutput(result.command);
    if (!command) {
      return { success: false, error: aiMessage('emptyCommand') };
    }

    return {
      success: true,
      command,
      warning: detectDangerousCommand(command),
    };
  } catch (error) {
    console.error('[AI] 生成命令失败:', error);
    if (axios.isAxiosError(error)) {
      return { success: false, error: buildErrorMessage(error) };
    }
    return { success: false, error: translateAIError(error, 'generateFailed') };
  }
}

export async function testAIConnection(config: AISettings): Promise<boolean> {
  validateAISettings({ ...config, enabled: true });
  const prompt = buildNL2CMDPrompt({
    query: '列出当前目录文件',
    osType: 'Linux',
    shellType: 'bash',
    currentPath: '~',
  });
  const result = config.provider === 'claude'
    ? await callClaude(config, prompt)
    : await callOpenAI(config, prompt);

  if (!cleanCommandOutput(result.command)) {
    throw new Error('ai.emptyCommand');
  }
  return true;
}

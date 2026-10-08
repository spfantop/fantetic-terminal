import { callOpenAI, callClaude, readAIErrorCode } from './nl2cmd.provider';
import axios from 'axios';
import i18next from '../i18n';
import { createLogger } from '../logging/logger';
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
  sanitizeAIChatLogText,
  sanitizeUserInput,
  validateBaseUrl,
} from './nl2cmd.helpers';
import type {
  AISettings,
  NL2CMDRequest,
  NL2CMDResponse,
} from './nl2cmd.types';

interface StoredAISettings extends Omit<AISettings, 'apiKey'> {
  encryptedApiKey?: string;
  apiKey?: string;
}

const logger = createLogger('AIService');

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
    logger.error('读取 AI 配置失败', { error });
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

export async function generateCommand(request: NL2CMDRequest): Promise<NL2CMDResponse> {
  const query = sanitizeUserInput(request.query || '');
  if (!query) {
    return { success: false, error: aiMessage('queryRequired'), errorCode: 'ai.queryRequired' };
  }

  let settings: AISettings | undefined;
  try {
    settings = await getAISettings();
    const endpoint = settings.provider === 'claude'
      ? '/messages'
      : settings.openaiEndpoint || DEFAULT_AI_SETTINGS.openaiEndpoint;
    logger.info('AI 聊天请求', {
      provider: settings.provider,
      model: settings.model,
      endpoint,
      query: sanitizeAIChatLogText(query),
      osType: request.osType || 'Linux',
      shellType: request.shellType || 'bash',
      currentPath: sanitizeAIChatLogText(request.currentPath || '~'),
    });
    if (!settings.enabled || !settings.apiKey) {
      logger.warn('AI 聊天请求未执行', {
        provider: settings.provider,
        model: settings.model,
        reason: settings.enabled ? 'missing_api_key' : 'disabled',
      });
      return { success: false, error: aiMessage('disabled'), errorCode: 'ai.disabled' };
    }

    validateAISettings(settings);
    const prompt = buildNL2CMDPrompt({ ...request, query });
    const result = settings.provider === 'claude'
      ? await callClaude(settings, prompt)
      : await callOpenAI(settings, prompt);
    const command = cleanCommandOutput(result.command);
    if (!command) {
      logger.warn('AI 聊天响应为空', {
        provider: settings.provider,
        model: settings.model,
      });
      return { success: false, error: aiMessage('emptyCommand'), errorCode: 'ai.emptyCommand' };
    }

    const warning = detectDangerousCommand(command);
    logger.info('AI 聊天响应', {
      provider: settings.provider,
      model: settings.model,
      command: sanitizeAIChatLogText(command),
      hasWarning: Boolean(warning),
      usage: result.usage,
    });

    return {
      success: true,
      command,
      warning,
    };
  } catch (error) {
    const errorCode = readAIErrorCode(error);
    const errorMessage = i18next.t(errorCode, { timeout: NL2CMD_CONFIG.TOTAL_TIMEOUT_MS });
    logger.error('AI 聊天请求失败', {
      provider: settings?.provider,
      model: settings?.model,
      endpoint: settings?.provider === 'claude' ? '/messages' : settings?.openaiEndpoint || DEFAULT_AI_SETTINGS.openaiEndpoint,
      status: axios.isAxiosError(error) ? error.response?.status : undefined,
      errorCode,
      error: sanitizeAIChatLogText(errorMessage),
    });
    return { success: false, error: errorMessage, errorCode };
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

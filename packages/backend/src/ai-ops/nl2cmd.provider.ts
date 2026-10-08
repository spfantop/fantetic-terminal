import axios from 'axios';
import { DEFAULT_AI_SETTINGS, NL2CMD_CONFIG } from './nl2cmd.constants';
import { isHtmlResponse, readProviderText } from './nl2cmd.helpers';
import type { AISettings, ClaudeResponse, OpenAIChatResponse, OpenAIResponsesResponse, ProviderResult } from './nl2cmd.types';

class ReasoningBudgetExceeded extends Error {}

async function retryWithBackoff<T>(fn: (timeout: number) => Promise<T>): Promise<T> {
  const deadline = Date.now() + NL2CMD_CONFIG.TOTAL_TIMEOUT_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(Math.max(1, Math.min(NL2CMD_CONFIG.REQUEST_TIMEOUT_MS, deadline - Date.now())));
    } catch (error) {
      const transient = error instanceof ReasoningBudgetExceeded || axios.isAxiosError(error) && !axios.isCancel(error) && (
        [429, 500, 502, 503, 504, 529].includes(error.response?.status || 0)
        || (!error.response && ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(error.code || ''))
      );
      const retryAfter = axios.isAxiosError(error) ? error.response?.headers['retry-after'] : undefined;
      const retryAfterMs = typeof retryAfter === 'string'
        ? (/^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now())
        : 0;
      const delay = Math.max(NL2CMD_CONFIG.RETRY_BASE_DELAY_MS * 2 ** attempt, Number.isFinite(retryAfterMs) ? retryAfterMs : 0);
      // 所有尝试共享预算，避免重试超过浏览器和反向代理的等待时间。
      if (!transient || attempt >= NL2CMD_CONFIG.MAX_RETRY_ATTEMPTS || Date.now() + delay >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
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
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('ai.emptyCommand');
  // Responses 成功响应也含 error: null；仅非空错误才表示上游失败。
  if ('error' in data && data.error != null) throw new Error('ai.serviceUnavailable');
}

function readCommand(data: unknown): string {
  const command = readProviderText(data);
  if (!command) throw new Error('ai.emptyCommand');
  return command;
}

export async function callOpenAI(config: AISettings, prompt: string): Promise<ProviderResult> {
  const endpointUrl = openAIEndpointUrl(config);
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };

  if (endpointUrl.includes('/responses')) {
    return retryWithBackoff(async (timeout) => {
      const response = await axios.post<OpenAIResponsesResponse>(
        endpointUrl,
        {
          model: config.model,
          input: prompt,
          max_output_tokens: NL2CMD_CONFIG.MAX_OUTPUT_TOKENS,
          temperature: NL2CMD_CONFIG.TEMPERATURE,
        },
        { headers, timeout },
      );
      assertProviderJsonResponse(response.data, response.headers['content-type']);

      if (response.data.status === 'incomplete') throw new Error('ai.outputTruncated');
      if (response.data.status && response.data.status !== 'completed') throw new Error('ai.serviceUnavailable');
      return { command: readCommand(response.data), usage: response.data.usage };
    });
  }

  let maxTokens: number = NL2CMD_CONFIG.MAX_OUTPUT_TOKENS;
  return retryWithBackoff(async (timeout) => {
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
        max_tokens: maxTokens,
        temperature: NL2CMD_CONFIG.TEMPERATURE,
      },
      { headers, timeout },
    );
    assertProviderJsonResponse(response.data, response.headers['content-type']);
    const choice = response.data.choices?.[0];
    // 思考 token 也占输出预算；只在响应明确耗尽预算时扩大一次，绝不把推理当成命令。
    if (choice?.finish_reason === 'length') {
      if (!readProviderText(choice.message?.content) && choice.message?.reasoning_content && maxTokens === NL2CMD_CONFIG.MAX_OUTPUT_TOKENS) {
        maxTokens = NL2CMD_CONFIG.REASONING_OUTPUT_TOKENS;
        throw new ReasoningBudgetExceeded('ai.outputTruncated');
      }
      throw new Error('ai.outputTruncated');
    }

    return {
      command: readCommand(response.data.choices?.[0]?.message?.content || response.data),
      usage: response.data.usage,
    };
  });
}

export async function callClaude(config: AISettings, prompt: string): Promise<ProviderResult> {
  const endpointUrl = `${config.baseUrl.replace(/\/$/, '')}/messages`;
  return retryWithBackoff(async (timeout) => {
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
        timeout,
      },
    );
    assertProviderJsonResponse(response.data, response.headers['content-type']);

    if (response.data.stop_reason === 'max_tokens') throw new Error('ai.outputTruncated');
    return {
      command: readCommand(response.data.content),
      usage: response.data.usage,
    };
  });
}

export function readAIErrorCode(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (['ECONNABORTED', 'ETIMEDOUT'].includes(error.code || '')) return 'ai.timeout';
    const codes: Record<number, string> = { 400: 'requestBadModel', 401: 'invalidApiKey', 403: 'permissionDenied', 404: 'endpointNotFound', 429: 'rateLimited' };
    return error.response ? `ai.${codes[error.response.status] || 'serviceUnavailable'}` : 'ai.connectFailed';
  }
  const allowed = ['unsupportedProvider', 'baseUrlProtocolInvalid', 'baseUrlLocalBlocked', 'modelRequired', 'apiKeyRequired', 'htmlResponse', 'emptyCommand', 'outputTruncated', 'serviceUnavailable'];
  return error instanceof Error && allowed.some(key => error.message === `ai.${key}`) ? error.message : 'ai.generateFailed';
}

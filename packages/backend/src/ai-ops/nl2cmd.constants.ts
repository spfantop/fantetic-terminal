export const AI_SETTINGS_KEY = 'aiProviderConfig';

export const DEFAULT_AI_SETTINGS = {
  enabled: false,
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-5-nano',
  openaiEndpoint: '/chat/completions',
  rateLimitEnabled: true,
} as const;

export const NL2CMD_CONFIG = {
  REQUEST_TIMEOUT_MS: 30000,
  MAX_QUERY_LENGTH: 500,
  MAX_OUTPUT_TOKENS: 500,
  TEMPERATURE: 0.3,
  MAX_RETRY_ATTEMPTS: 2,
  RETRY_BASE_DELAY_MS: 1000,
} as const;

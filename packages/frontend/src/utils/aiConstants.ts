import type { OpenAIEndpoint } from '../types/nl2cmd.types';

export const AI_REQUEST_TIMEOUT_MS = 30000;
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_CLAUDE_BASE_URL = 'https://api.anthropic.com/v1';

export const OPENAI_ENDPOINT_OPTIONS: Array<{ value: OpenAIEndpoint; label: string }> = [
  { value: '/chat/completions', label: '/chat/completions' },
  { value: '/responses', label: '/responses' },
];

export const AI_PROVIDER_DEFAULTS = {
  openai: {
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    model: 'gpt-5-nano',
    endpoint: '/chat/completions' as OpenAIEndpoint,
  },
  claude: {
    baseUrl: DEFAULT_CLAUDE_BASE_URL,
    model: 'claude-haiku-4-5-20251001',
  },
} as const;

export type AIProvider = 'openai' | 'claude';
export type OpenAIEndpoint = '/chat/completions' | '/responses';

export interface AISettings {
  enabled: boolean;
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  openaiEndpoint?: OpenAIEndpoint;
  rateLimitEnabled?: boolean;
}

export interface NL2CMDRequest {
  query: string;
  osType?: string;
  shellType?: string;
  currentPath?: string;
}

export interface NL2CMDResponse {
  success: boolean;
  command?: string;
  warning?: string;
  error?: string;
}

export interface AISettingsResponse {
  success: boolean;
  settings: AISettings;
  message?: string;
}

export interface AITestResponse {
  success: boolean;
  message?: string;
  error?: string;
}

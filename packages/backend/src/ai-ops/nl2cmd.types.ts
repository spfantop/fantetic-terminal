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
  debug?: boolean;
}

export interface NL2CMDResponse {
  success: boolean;
  command?: string;
  warning?: string;
  error?: string;
}

export interface ProviderResult {
  command: string;
  usage?: unknown;
}

export interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  usage?: unknown;
}

export interface OpenAIResponsesResponse {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
      output_text?: string;
    }>;
  }>;
  usage?: unknown;
}

export interface ClaudeResponse {
  content?: Array<{
    text?: string;
  }>;
  usage?: unknown;
}

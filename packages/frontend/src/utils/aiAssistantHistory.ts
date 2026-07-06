export type AssistantMessageRole = 'user' | 'assistant';

export interface AssistantMessage {
  id: string;
  role: AssistantMessageRole;
  content: string;
  command?: string;
  warning?: string;
  timestamp: Date;
}

interface StoredAssistantMessage extends Omit<AssistantMessage, 'timestamp'> {
  timestamp: string;
}

export interface AssistantConversation {
  id: string;
  title: string;
  updatedAt: Date;
  messages: AssistantMessage[];
}

interface StoredAssistantConversation extends Omit<AssistantConversation, 'updatedAt' | 'messages'> {
  updatedAt: string;
  messages: StoredAssistantMessage[];
}

export const AI_ASSISTANT_HISTORY_STORAGE_KEY = 'fantetic_terminal_ai_assistant_history';
export const AI_ASSISTANT_HISTORY_LIMIT = 30;

function serializeAssistantMessage(message: AssistantMessage): StoredAssistantMessage {
  return {
    ...message,
    timestamp: message.timestamp.toISOString(),
  };
}

function parseAssistantMessage(value: unknown): AssistantMessage | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<StoredAssistantMessage>;
  if (
    typeof record.id !== 'string'
    || (record.role !== 'user' && record.role !== 'assistant')
    || typeof record.content !== 'string'
    || typeof record.timestamp !== 'string'
  ) {
    return null;
  }

  const timestamp = new Date(record.timestamp);
  if (Number.isNaN(timestamp.getTime())) return null;

  return {
    id: record.id,
    role: record.role,
    content: record.content,
    command: typeof record.command === 'string' ? record.command : undefined,
    warning: typeof record.warning === 'string' ? record.warning : undefined,
    timestamp,
  };
}

export function serializeAssistantHistory(messages: readonly AssistantMessage[]): string {
  const storedMessages: StoredAssistantMessage[] = messages
    .slice(0, AI_ASSISTANT_HISTORY_LIMIT)
    .map(serializeAssistantMessage);
  return JSON.stringify(storedMessages);
}

export function serializeAssistantConversations(conversations: readonly AssistantConversation[]): string {
  const storedConversations: StoredAssistantConversation[] = conversations
    .slice(0, AI_ASSISTANT_HISTORY_LIMIT)
    .map(conversation => ({
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt.toISOString(),
      messages: conversation.messages.map(serializeAssistantMessage),
    }));
  return JSON.stringify(storedConversations);
}

export function parseAssistantHistory(raw: string | null): AssistantConversation[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item): AssistantConversation | null => {
        if (!item || typeof item !== 'object') return null;
        const conversation = item as Partial<StoredAssistantConversation>;
        if (
          typeof conversation.id === 'string'
          && typeof conversation.title === 'string'
          && typeof conversation.updatedAt === 'string'
          && Array.isArray(conversation.messages)
        ) {
          const updatedAt = new Date(conversation.updatedAt);
          if (Number.isNaN(updatedAt.getTime())) return null;
          const messages = conversation.messages
            .map(parseAssistantMessage)
            .filter((message): message is AssistantMessage => message !== null);
          if (messages.length === 0) return null;

          return {
            id: conversation.id,
            title: conversation.title,
            updatedAt,
            messages,
          };
        }

        const legacyMessage = parseAssistantMessage(item);
        if (!legacyMessage) return null;
        return {
          id: legacyMessage.id,
          title: legacyMessage.command || legacyMessage.content,
          updatedAt: legacyMessage.timestamp,
          messages: [legacyMessage],
        };
      })
      .filter((conversation): conversation is AssistantConversation => conversation !== null)
      .slice(0, AI_ASSISTANT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

import assert from 'node:assert/strict';
import {
  AI_ASSISTANT_HISTORY_LIMIT,
  parseAssistantHistory,
  serializeAssistantConversations,
  serializeAssistantHistory,
  type AssistantConversation,
  type AssistantMessage,
} from '../src/utils/aiAssistantHistory';

const messages: AssistantMessage[] = [
  {
    id: 'assistant-1',
    role: 'assistant',
    content: '命令已生成',
    command: 'ls -la',
    timestamp: new Date('2026-07-06T08:00:00.000Z'),
  },
  {
    id: 'user-1',
    role: 'user',
    content: '列出文件',
    timestamp: new Date('2026-07-06T07:59:58.000Z'),
  },
];

const restored = parseAssistantHistory(serializeAssistantHistory(messages));
assert.equal(restored.length, 2, 'AI assistant history should restore saved messages');
assert.equal(restored[0].messages[0].command, 'ls -la', 'legacy AI assistant history should keep generated commands');
assert.ok(restored[0].updatedAt instanceof Date, 'legacy AI assistant history should restore timestamps as Date objects');
assert.equal(restored[0].updatedAt.toISOString(), '2026-07-06T08:00:00.000Z');

const oversizedHistory = Array.from({ length: AI_ASSISTANT_HISTORY_LIMIT + 5 }, (_, index): AssistantMessage => ({
  id: `msg-${index}`,
  role: 'user',
  content: `prompt-${index}`,
  timestamp: new Date('2026-07-06T08:00:00.000Z'),
}));

assert.equal(
  parseAssistantHistory(serializeAssistantHistory(oversizedHistory)).length,
  AI_ASSISTANT_HISTORY_LIMIT,
  'AI assistant history should keep a bounded number of entries',
);

assert.deepEqual(parseAssistantHistory('<bad json>'), [], 'invalid cached history should be ignored');

const conversations: AssistantConversation[] = [
  {
    id: 'conversation-1',
    title: '列出文件',
    updatedAt: new Date('2026-07-06T08:00:01.000Z'),
    messages: [
      {
        id: 'user-conversation-1',
        role: 'user',
        content: '列出文件',
        timestamp: new Date('2026-07-06T08:00:00.000Z'),
      },
      {
        id: 'assistant-conversation-1',
        role: 'assistant',
        content: '命令已生成',
        command: 'ls -la',
        timestamp: new Date('2026-07-06T08:00:01.000Z'),
      },
    ],
  },
];

const restoredConversations = parseAssistantHistory(serializeAssistantConversations(conversations));
assert.equal(restoredConversations.length, 1, 'AI assistant history should restore saved conversations');
assert.equal(restoredConversations[0].messages.length, 2, 'selecting history should be able to restore the whole conversation');
assert.equal(restoredConversations[0].messages[0].content, '列出文件');
assert.equal(restoredConversations[0].messages[1].command, 'ls -la');
assert.ok(restoredConversations[0].updatedAt instanceof Date, 'conversation timestamps should restore as Date objects');

console.log('AI assistant history behavior ok');

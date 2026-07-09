<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '../stores/session.store';
import { useNL2CMD } from '../composables/terminal/useNL2CMD';
import { useWorkspaceEventEmitter } from '../composables/workspaceEvents';
import {
  AI_ASSISTANT_HISTORY_LIMIT,
  AI_ASSISTANT_HISTORY_STORAGE_KEY,
  parseAssistantHistory,
  serializeAssistantConversations,
  type AssistantConversation,
  type AssistantMessage,
} from '../utils/aiAssistantHistory';

interface DebugEntry {
  id: string;
  type: 'request' | 'response';
  timestamp: Date;
  payload: unknown;
}

const { t } = useI18n();
const sessionStore = useSessionStore();
const emitWorkspaceEvent = useWorkspaceEventEmitter();
const { activeSessionId } = storeToRefs(sessionStore);
const { updateSessionCommandInput } = sessionStore;

const assistantRootRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const chatContainerRef = ref<HTMLElement | null>(null);
const inputMessage = ref('');
const showHistory = ref(false);
const showDebug = ref(false);
const messages = ref<AssistantMessage[]>([]);
const history = ref<AssistantConversation[]>([]);
const debugEntries = ref<DebugEntry[]>([]);
const lastGeneratedCommand = ref('');
const currentConversationId = ref('');

const nl2cmd = useNL2CMD();
const {
  query,
  isLoading,
  isAIEnabled,
  lastResponse,
  lastError,
  generateCommand,
} = nl2cmd;

const activeSshSession = computed(() => {
  const sessionId = activeSessionId.value;
  if (!sessionId) return null;
  const session = sessionStore.sessions.get(sessionId);
  return session?.kind === 'ssh' ? session : null;
});

const sessionLabel = computed(() => (
  activeSshSession.value?.connectionName || t('ai.nl2cmd.noSession', 'No SSH session')
));

const canGenerate = computed(() => (
  isAIEnabled.value && !!activeSshSession.value && inputMessage.value.trim().length > 0 && !isLoading.value
));

const quickSuggestions = computed(() => [
  {
    key: 'largeFiles',
    icon: 'fa-folder-open',
    text: t('ai.nl2cmd.suggestions.largeFiles', '查找当前目录下最大的 10 个文件'),
  },
  {
    key: 'ports',
    icon: 'fa-network-wired',
    text: t('ai.nl2cmd.suggestions.ports', '查看正在监听的端口'),
  },
  {
    key: 'disk',
    icon: 'fa-hard-drive',
    text: t('ai.nl2cmd.suggestions.disk', '查看磁盘占用并按大小排序'),
  },
  {
    key: 'logs',
    icon: 'fa-file-lines',
    text: t('ai.nl2cmd.suggestions.logs', '实时查看最近的错误日志'),
  },
]);

const formatTime = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const readLastCommand = (conversationMessages: readonly AssistantMessage[]) => (
  [...conversationMessages].reverse().find(message => message.command)?.command || ''
);

const readAssistantWindow = () => assistantRootRef.value?.ownerDocument.defaultView ?? window;
const readAssistantClipboard = () => readAssistantWindow().navigator.clipboard;

const createId = (prefix: string) => `${Date.now()}-${prefix}-${Math.random().toString(36).slice(2, 8)}`;

const ensureConversationId = () => {
  if (!currentConversationId.value) {
    currentConversationId.value = createId('conversation');
  }
  return currentConversationId.value;
};

const createConversationSnapshot = (): AssistantConversation | null => {
  if (messages.value.length === 0) return null;
  const firstUserMessage = messages.value.find(message => message.role === 'user');
  const lastMessage = messages.value[messages.value.length - 1];
  return {
    id: ensureConversationId(),
    title: firstUserMessage?.content || lastMessage.content,
    updatedAt: lastMessage.timestamp,
    messages: messages.value.map(message => ({ ...message, timestamp: new Date(message.timestamp) })),
  };
};

const persistHistory = () => {
  try {
    localStorage.setItem(AI_ASSISTANT_HISTORY_STORAGE_KEY, serializeAssistantConversations(history.value));
  } catch (error) {
    console.warn('[AIAssistantPanel] Failed to persist AI assistant history:', error);
  }
};

const saveCurrentConversation = () => {
  const snapshot = createConversationSnapshot();
  if (!snapshot) return;
  history.value = [
    snapshot,
    ...history.value.filter(conversation => conversation.id !== snapshot.id),
  ].slice(0, AI_ASSISTANT_HISTORY_LIMIT);
  persistHistory();
};

const scrollToBottom = () => {
  nextTick(() => {
    const el = chatContainerRef.value;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  });
};

const appendMessage = (message: Omit<AssistantMessage, 'id' | 'timestamp'>) => {
  const fullMessage: AssistantMessage = {
    ...message,
    id: createId('message'),
    timestamp: new Date(),
  };
  messages.value.push(fullMessage);
  saveCurrentConversation();
  scrollToBottom();
  return fullMessage;
};

const addDebugEntry = (type: DebugEntry['type'], payload: unknown) => {
  debugEntries.value.unshift({
    id: createId(type),
    type,
    timestamp: new Date(),
    payload,
  });
  debugEntries.value = debugEntries.value.slice(0, 20);
};

const applyCommandToSession = (command: string) => {
  const session = activeSshSession.value;
  if (!session) return;
  updateSessionCommandInput(session.sessionId, command);
};

const submitPrompt = async () => {
  if (!canGenerate.value) return;

  const prompt = inputMessage.value.trim();
  inputMessage.value = '';
  query.value = prompt;
  lastGeneratedCommand.value = '';

  appendMessage({ role: 'user', content: prompt });
  addDebugEntry('request', {
    query: prompt,
    sessionId: activeSshSession.value?.sessionId,
    target: sessionLabel.value,
  });

  const command = await generateCommand();
  if (!command) {
    appendMessage({
      role: 'assistant',
      content: lastError.value || t('ai.nl2cmd.noCommandGenerated', '没有生成可用命令，请换一种更具体的描述。'),
    });
    addDebugEntry('response', lastResponse.value || { success: false, command: null });
    return;
  }

  lastGeneratedCommand.value = command;
  applyCommandToSession(command);
  appendMessage({
    role: 'assistant',
    content: t('ai.nl2cmd.commandReady', '已生成命令并填入当前终端命令栏。确认无误后再按 Enter 执行。'),
    command,
    warning: lastResponse.value?.warning,
  });
  addDebugEntry('response', lastResponse.value || { success: true, command });
};

const sendSuggestion = async (text: string) => {
  inputMessage.value = text;
  await submitPrompt();
};

const reuseCommand = (command: string) => {
  applyCommandToSession(command);
};

const executeCommand = (command: string) => {
  const session = activeSshSession.value;
  if (!session) return;
  emitWorkspaceEvent('terminal:sendCommand', { command, sessionId: session.sessionId });
  updateSessionCommandInput(session.sessionId, '');
};

const copyCommand = async (command: string) => {
  await readAssistantClipboard()?.writeText(command);
};

const startNewSession = () => {
  messages.value = [];
  currentConversationId.value = '';
  lastGeneratedCommand.value = '';
  inputMessage.value = '';
  nextTick(() => inputRef.value?.focus());
};

const selectHistoryItem = (conversation: AssistantConversation) => {
  currentConversationId.value = conversation.id;
  messages.value = conversation.messages.map(message => ({ ...message, timestamp: new Date(message.timestamp) }));
  lastGeneratedCommand.value = readLastCommand(messages.value);
  inputMessage.value = '';
  showHistory.value = false;
  scrollToBottom();
};

onMounted(() => {
  history.value = parseAssistantHistory(localStorage.getItem(AI_ASSISTANT_HISTORY_STORAGE_KEY));
});

watch(() => messages.value.length, scrollToBottom);
</script>

<template>
  <section ref="assistantRootRef" class="ai-assistant-panel relative flex h-full min-h-0 flex-col bg-background text-foreground">
    <header class="flex items-center justify-between gap-2 border-b border-border bg-header px-3 py-2">
      <div class="flex min-w-0 items-center gap-2">
        <i class="fas fa-robot text-primary"></i>
        <div class="min-w-0">
          <h2 class="m-0 truncate text-sm font-semibold">{{ t('ai.nl2cmd.panelTitle') }}</h2>
          <p class="m-0 truncate text-[11px] text-text-secondary">{{ sessionLabel }}</p>
        </div>
      </div>
      <div class="flex items-center gap-1">
        <button type="button" class="ai-icon-button" :title="t('ai.nl2cmd.newSession')" @click="startNewSession">
          <i class="fas fa-plus"></i>
        </button>
        <button type="button" class="ai-icon-button" :title="t('ai.nl2cmd.history')" @click="showHistory = true">
          <i class="fas fa-history"></i>
        </button>
        <button type="button" class="ai-icon-button" :title="t('ai.nl2cmd.debug')" @click="showDebug = !showDebug">
          <i class="fas fa-bug"></i>
        </button>
      </div>
    </header>

    <div ref="chatContainerRef" class="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
      <div v-if="messages.length === 0" class="mx-auto flex h-full max-w-md flex-col justify-center gap-3 text-center">
        <i class="fas fa-wand-magic-sparkles text-3xl text-primary/80"></i>
        <div>
          <p class="m-0 text-sm font-semibold">{{ t('ai.nl2cmd.emptyTitle') }}</p>
          <p class="mt-1 text-xs text-text-secondary">{{ t('ai.nl2cmd.emptySubtitle') }}</p>
        </div>
        <div class="grid gap-2 text-left">
          <button
            v-for="suggestion in quickSuggestions"
            :key="suggestion.key"
            type="button"
            class="ai-suggestion-button"
            :disabled="!isAIEnabled || !activeSshSession || isLoading"
            @click="sendSuggestion(suggestion.text)"
          >
            <i :class="['fas', suggestion.icon]"></i>
            <span>{{ suggestion.text }}</span>
          </button>
        </div>
      </div>

      <div v-else class="flex flex-col gap-3">
        <article
          v-for="message in messages"
          :key="message.id"
          :class="['flex flex-col', message.role === 'user' ? 'items-end' : 'items-start']"
        >
          <div :class="['ai-message', message.role === 'user' ? 'ai-message--user' : 'ai-message--assistant']">
            <p class="m-0 whitespace-pre-wrap">{{ message.content }}</p>
            <div v-if="message.command" class="mt-2 rounded border border-border bg-background/80 p-2 font-mono text-xs">
              {{ message.command }}
            </div>
            <p v-if="message.warning" class="mt-2 text-xs text-warning">{{ message.warning }}</p>
            <div v-if="message.command" class="mt-2 flex flex-wrap gap-2">
              <button type="button" class="ai-mini-button" @click="reuseCommand(message.command)">
                <i class="fas fa-terminal"></i>
                {{ t('ai.nl2cmd.fillAgain') }}
              </button>
              <button type="button" class="ai-mini-button ai-mini-button--primary" @click="executeCommand(message.command)">
                <i class="fas fa-play"></i>
                {{ t('ai.nl2cmd.executeNow') }}
              </button>
              <button type="button" class="ai-mini-button" @click="copyCommand(message.command)">
                <i class="fas fa-copy"></i>
                {{ t('common.copy') }}
              </button>
            </div>
          </div>
          <span class="mt-1 text-[11px] text-text-secondary">{{ formatTime(message.timestamp) }}</span>
        </article>
        <div v-if="isLoading" class="self-start text-xs italic text-text-secondary">
          <i class="fas fa-spinner fa-spin mr-1"></i>{{ t('ai.nl2cmd.generating') }}
        </div>
      </div>
    </div>

<!--    <div v-if="lastGeneratedCommand" class="border-t border-border bg-header/30 px-3 py-2">-->
<!--      <div class="flex items-center justify-between gap-2">-->
<!--        <span class="truncate font-mono text-xs text-text-secondary">{{ lastGeneratedCommand }}</span>-->
<!--        <button type="button" class="ai-mini-button" @click="reuseCommand(lastGeneratedCommand)">-->
<!--          <i class="fas fa-arrow-turn-down"></i>-->
<!--          {{ t('ai.nl2cmd.fillAgain') }}-->
<!--        </button>-->
<!--        <button type="button" class="ai-mini-button ai-mini-button&#45;&#45;primary" @click="executeCommand(lastGeneratedCommand)">-->
<!--          <i class="fas fa-play"></i>-->
<!--          {{ t('ai.nl2cmd.executeNow') }}-->
<!--        </button>-->
<!--      </div>-->
<!--    </div>-->

    <footer class="border-t border-border bg-header/30 p-2">
      <p v-if="!isAIEnabled" class="mb-1 text-xs text-warning">{{ t('ai.nl2cmd.enableInSettings') }}</p>
      <p v-else-if="!activeSshSession" class="mb-1 text-xs text-text-secondary">{{ t('ai.nl2cmd.requiresSshSession') }}</p>
      <div class="flex items-end gap-2">
        <textarea
          ref="inputRef"
          v-model="inputMessage"
          class="ai-input custom-scrollbar"
          rows="1"
          :placeholder="t('ai.nl2cmd.panelPlaceholder')"
          :disabled="!isAIEnabled || !activeSshSession || isLoading"
          @keydown.ctrl.enter.prevent="submitPrompt"
        ></textarea>
        <button
          type="button"
          class="ai-send-button"
          :disabled="!canGenerate"
          :title="t('ai.nl2cmd.generate')"
          @click="submitPrompt"
        >
          <i :class="isLoading ? 'fas fa-spinner fa-spin' : 'fas fa-paper-plane'"></i>
        </button>
      </div>
    </footer>

    <div v-if="showHistory" class="absolute inset-0 z-10 flex flex-col bg-background">
      <header class="flex items-center justify-between border-b border-border bg-header px-3 py-2">
        <span class="text-sm font-semibold">{{ t('ai.nl2cmd.history') }}</span>
        <button type="button" class="ai-icon-button" @click="showHistory = false">
          <i class="fas fa-arrow-left"></i>
        </button>
      </header>
      <div class="custom-scrollbar flex-1 overflow-y-auto p-3">
        <p v-if="history.length === 0" class="text-center text-sm text-text-secondary">{{ t('ai.nl2cmd.noHistory') }}</p>
        <button
          v-for="conversation in history"
          :key="conversation.id"
          type="button"
          class="mb-2 block w-full rounded border border-border bg-header/40 p-2 text-left text-xs hover:border-primary"
          @click="selectHistoryItem(conversation)"
        >
          <div class="truncate font-medium">{{ conversation.title }}</div>
          <div class="mt-1 text-text-secondary">{{ conversation.messages.length }} {{ t('ai.nl2cmd.historyMessages') }}</div>
          <div v-if="readLastCommand(conversation.messages)" class="mt-1 truncate font-mono text-text-secondary">
            {{ readLastCommand(conversation.messages) }}
          </div>
          <div class="mt-1 text-text-secondary">{{ formatTime(conversation.updatedAt) }}</div>
        </button>
      </div>
    </div>

    <div v-if="showDebug" class="max-h-44 border-t border-border bg-background">
      <div class="flex items-center justify-between px-3 py-2">
        <span class="text-xs font-semibold">{{ t('ai.nl2cmd.debug') }}</span>
        <button type="button" class="ai-mini-button" @click="debugEntries = []">{{ t('common.clear', '清空') }}</button>
      </div>
      <div class="custom-scrollbar max-h-32 overflow-y-auto px-3 pb-2">
        <pre
          v-for="entry in debugEntries"
          :key="entry.id"
          class="mb-2 overflow-auto rounded bg-header p-2 text-[11px] text-text-secondary"
        >{{ entry.type }} {{ formatTime(entry.timestamp) }}\n{{ JSON.stringify(entry.payload, null, 2) }}</pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ai-icon-button {
  width: 1.8rem;
  height: 1.8rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 0.35rem;
  color: var(--text-color-secondary);
}

.ai-icon-button:hover {
  border-color: var(--border-color);
  color: var(--text-color);
}

.ai-suggestion-button,
.ai-mini-button {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid var(--border-color);
  border-radius: 0.4rem;
  color: var(--text-color);
  background: var(--header-bg-color);
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ai-suggestion-button {
  width: 100%;
  padding: 0.55rem 0.7rem;
  font-size: 0.75rem;
}

.ai-mini-button {
  padding: 0.25rem 0.45rem;
  font-size: 0.72rem;
}

.ai-suggestion-button:hover:not(:disabled),
.ai-mini-button:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.ai-mini-button--primary {
  border-color: var(--primary-color);
  background: var(--button-bg-color);
  color: var(--button-text-color);
}

.ai-mini-button--primary:hover {
  color: var(--button-text-color);
  filter: brightness(1.08);
}

.ai-message {
  max-width: min(86%, 34rem);
  border-radius: 0.65rem;
  padding: 0.65rem 0.75rem;
  font-size: 0.83rem;
  line-height: 1.45;
}

.ai-message--user {
  background: var(--primary-color);
  color: #fff;
}

.ai-message--assistant {
  border: 1px solid var(--border-color);
  background: var(--header-bg-color);
}

.ai-input {
  min-width: 0;
  flex: 1;
  resize: none;
  height: 2.25rem;
  min-height: 2.25rem;
  max-height: 4.5rem;
  border: 1px solid var(--border-color);
  border-radius: 0.45rem;
  background: var(--input-bg-color);
  color: var(--text-color);
  padding: 0.42rem 0.6rem;
  font-size: 0.82rem;
  line-height: 1.25;
  outline: none;
  overflow-y: auto;
}

.ai-input:focus {
  border-color: var(--primary-color);
}

.ai-send-button {
  width: 2.25rem;
  height: 2.25rem;
  flex: 0 0 2.25rem;
  border-radius: 0.45rem;
  background: var(--button-bg-color);
  color: var(--button-text-color);
}

.ai-send-button:disabled,
.ai-suggestion-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 999px;
}
</style>

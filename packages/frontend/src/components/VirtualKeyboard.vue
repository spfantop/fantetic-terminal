<script setup lang="ts">
import { computed, ref } from 'vue';
import { debugLogLazy } from '../composables/useDebugLog';

const emit = defineEmits<{
  (e: 'send-key', keySequence: string): void;
  (e: 'hide'): void;
}>();

type KeyboardMode = 'letters' | 'symbols' | 'commands';
type CommandAction = 'insert' | 'execute';
type KeyType =
  | 'modifier'
  | 'control'
  | 'char'
  | 'navigation'
  | 'mode'
  | 'space'
  | 'shift'
  | 'paste'
  | 'command-template'
  | 'command-action'
  | 'hide'
  | 'noop';

interface KeyDefinition {
  label: string;
  ariaLabel?: string;
  sequence?: string;
  type: KeyType;
  flex?: number;
  mode?: KeyboardMode;
  commandAction?: CommandAction;
}

interface KeyRow {
  id: string;
  keys: KeyDefinition[];
}

const mode = ref<KeyboardMode>('letters');
const isCtrlActive = ref(false);
const isAltActive = ref(false);
const isShiftActive = ref(false);
const selectedCommandTemplate = ref('ls -la');

const shiftMap: Record<string, string> = {
  '`': '~',
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
};

const shiftValueFor = (value: string) => {
  if (value.length === 1 && value >= 'a' && value <= 'z') {
    return value.toUpperCase();
  }
  return shiftMap[value] ?? value;
};

const displayLabelFor = (keyDef: KeyDefinition) => {
  if (keyDef.type === 'char' && isShiftActive.value && mode.value === 'letters') {
    return shiftValueFor(keyDef.sequence ?? keyDef.label);
  }
  return keyDef.label;
};

const toggleModifier = (modifier: 'ctrl' | 'alt') => {
  if (modifier === 'ctrl') {
    isCtrlActive.value = !isCtrlActive.value;
    return;
  }
  isAltActive.value = !isAltActive.value;
};

const resetModifiers = () => {
  isCtrlActive.value = false;
  isAltActive.value = false;
  isShiftActive.value = false;
};

const controlSequenceFor = (keyDef: KeyDefinition) => {
  const rawLabel = (keyDef.sequence ?? keyDef.label).toUpperCase();
  if (rawLabel.length === 1 && rawLabel >= 'A' && rawLabel <= 'Z') {
    return String.fromCharCode(rawLabel.charCodeAt(0) - 'A'.charCodeAt(0) + 1);
  }
  if (rawLabel === '[' || keyDef.sequence === '\x1b') return '\x1b';
  if (rawLabel === ']') return '\x1d';
  if (rawLabel === '\\') return '\x1c';
  if (rawLabel === '?') return '\x7f';
  return keyDef.sequence ?? keyDef.label;
};

const emitKeySequence = (sequence: string, label: string) => {
  debugLogLazy(() => [`[VirtualKeyboard] Sending ${label}: ${JSON.stringify(sequence)}`]);
  emit('send-key', sequence);
};

const pasteFromClipboard = async () => {
  try {
    const text = await navigator.clipboard?.readText?.();
    if (text) {
      emitKeySequence(text, 'clipboard text');
    }
  } catch (error) {
    debugLogLazy(() => ['[VirtualKeyboard] Clipboard paste failed:', error]);
  } finally {
    resetModifiers();
  }
};

const sendCommandAction = (keyDef: KeyDefinition) => {
  const command = selectedCommandTemplate.value;
  if (!command) return;
  const sequence = keyDef.commandAction === 'execute' ? `${command}\r` : command;
  emitKeySequence(sequence, keyDef.commandAction === 'execute' ? 'command execute' : 'command insert');
  resetModifiers();
};

const sendKey = async (keyDef: KeyDefinition) => {
  if (keyDef.type === 'mode' && keyDef.mode) {
    mode.value = keyDef.mode;
    resetModifiers();
    return;
  }

  if (keyDef.type === 'modifier') {
    toggleModifier(keyDef.label.toLowerCase() as 'ctrl' | 'alt');
    return;
  }

  if (keyDef.type === 'shift') {
    isShiftActive.value = !isShiftActive.value;
    return;
  }

  if (keyDef.type === 'paste') {
    await pasteFromClipboard();
    return;
  }

  if (keyDef.type === 'hide') {
    emit('hide');
    resetModifiers();
    return;
  }

  if (keyDef.type === 'noop') {
    resetModifiers();
    return;
  }

  if (keyDef.type === 'command-template') {
    selectedCommandTemplate.value = keyDef.sequence ?? keyDef.label;
    resetModifiers();
    return;
  }

  if (keyDef.type === 'command-action') {
    sendCommandAction(keyDef);
    return;
  }

  let sequence = keyDef.sequence ?? keyDef.label;
  if (keyDef.type === 'char' && isShiftActive.value && mode.value === 'letters') {
    sequence = shiftValueFor(sequence);
  }
  if (isCtrlActive.value) {
    sequence = controlSequenceFor({ ...keyDef, sequence });
  }
  if (isAltActive.value) {
    sequence = `\x1b${sequence}`;
  }

  emitKeySequence(sequence, keyDef.label);
  resetModifiers();
};

const controlRow: KeyRow = {
  id: 'quick-actions',
  keys: [
    { label: 'Esc', sequence: '\x1b', type: 'control' },
    { label: 'Tab', sequence: '\t', type: 'control' },
    { label: 'Ctrl', type: 'modifier' },
    { label: 'Alt', type: 'modifier' },
    { label: '↑', ariaLabel: 'Arrow Up', sequence: '\x1b[A', type: 'navigation' },
    { label: '↓', ariaLabel: 'Arrow Down', sequence: '\x1b[B', type: 'navigation' },
    { label: '←', ariaLabel: 'Arrow Left', sequence: '\x1b[D', type: 'navigation' },
    { label: '→', ariaLabel: 'Arrow Right', sequence: '\x1b[C', type: 'navigation' },
    { label: 'Paste', type: 'paste', flex: 1.28 },
    { label: 'Enter', sequence: '\r', type: 'control', flex: 1.25 },
  ],
};

const modeTabs: KeyDefinition[] = [
  { label: '字母', type: 'mode', mode: 'letters' },
  { label: '符号', type: 'mode', mode: 'symbols' },
  { label: '命令', type: 'mode', mode: 'commands' },
];

const letterRows: KeyRow[] = [
  {
    id: 'numbers',
    keys: ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='].map(label => ({ label, type: 'char' })),
  },
  {
    id: 'qwerty',
    keys: ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']'].map(label => ({ label, type: 'char' })),
  },
  {
    id: 'home',
    keys: ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"].map(label => ({ label, type: 'char' })),
  },
  {
    id: 'bottom',
    keys: [
      { label: '⇧', ariaLabel: 'Shift', type: 'shift', flex: 1.08 },
      ...['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'].map(label => ({ label, type: 'char' as const })),
      { label: '⌫', ariaLabel: 'Backspace', sequence: '\x7f', type: 'control', flex: 1.08 },
    ],
  },
  {
    id: 'space',
    keys: [
      { label: 'Ctrl', type: 'modifier', flex: 1.25 },
      { label: 'Alt', type: 'modifier', flex: 1.25 },
      { label: '空格', sequence: ' ', type: 'space', flex: 3.9 },
      { label: '⇧', ariaLabel: 'Shift', type: 'shift' },
      { label: '⌄', ariaLabel: '隐藏键盘', type: 'hide' },
    ],
  },
];

const symbolRows: KeyRow[] = [
  {
    id: 'symbols-top',
    keys: ['/', '\\', '|', '~', '`', '_', '=', '≠'].map(label => ({ label, type: 'char' })),
  },
  {
    id: 'shell-symbols',
    keys: [':', ';', "'", '"', ',', '`', '>>', '!'].map(label => ({ label, type: 'char' })),
  },
  {
    id: 'bracket-symbols',
    keys: ['[', ']', '{', '}', '(', ')', '$', '#', '%'].map(label => ({ label, type: 'char' })),
  },
  {
    id: 'operator-symbols',
    keys: [
      { label: '*', type: 'char' },
      { label: '&', type: 'char' },
      { label: '^', type: 'char' },
      { label: '?', type: 'char' },
      { label: '@', type: 'char' },
      { label: '⌫', ariaLabel: 'Backspace', sequence: '\x7f', type: 'control' },
      { label: '全角', type: 'noop', flex: 1.35 },
    ],
  },
];

const commandRows: KeyRow[] = [
  {
    id: 'cmd-primary',
    keys: [
      { label: 'ls -la', sequence: 'ls -la', type: 'command-template' },
      { label: 'cd ..', sequence: 'cd ..', type: 'command-template' },
      { label: 'pwd', sequence: 'pwd', type: 'command-template' },
      { label: 'clear', sequence: 'clear', type: 'command-template' },
    ],
  },
  {
    id: 'cmd-docker',
    keys: [
      { label: 'docker ps', sequence: 'docker ps', type: 'command-template' },
      { label: 'docker logs -f', sequence: 'docker logs -f ', type: 'command-template' },
    ],
  },
  {
    id: 'cmd-status',
    keys: [
      { label: 'git status', sequence: 'git status', type: 'command-template' },
      { label: 'tail -f', sequence: 'tail -f ', type: 'command-template' },
    ],
  },
  {
    id: 'cmd-system',
    keys: [
      { label: 'cat /etc/passwd', sequence: 'cat /etc/passwd', type: 'command-template' },
      { label: 'systemctl status', sequence: 'systemctl status ', type: 'command-template' },
    ],
  },
];

const commandActionKeys: KeyDefinition[] = [
  { label: '插入', ariaLabel: '插入命令', type: 'command-action', commandAction: 'insert' },
  { label: '执行', ariaLabel: '执行命令', type: 'command-action', commandAction: 'execute' },
];

const keyRows: KeyRow[] = [
  controlRow,
];

const modeRows = computed<KeyRow[]>(() => {
  if (mode.value === 'symbols') return symbolRows;
  if (mode.value === 'commands') return commandRows;
  return letterRows;
});

const isLockKeyActive = (keyDef: KeyDefinition) => (
  (keyDef.label === 'Ctrl' && isCtrlActive.value)
  || (keyDef.label === 'Alt' && isAltActive.value)
  || (keyDef.type === 'shift' && isShiftActive.value)
);

const keyClass = (keyDef: KeyDefinition) => ({
  'virtual-key-active': isLockKeyActive(keyDef),
  'virtual-key-mode-active': keyDef.type === 'mode' && keyDef.mode === mode.value,
  'virtual-key-template-active': keyDef.type === 'command-template' && selectedCommandTemplate.value === (keyDef.sequence ?? keyDef.label),
  'virtual-key-space': keyDef.type === 'space',
  'virtual-key-control': keyDef.type === 'control' || keyDef.type === 'paste',
  'virtual-key-navigation': keyDef.type === 'navigation',
  'virtual-key-command-action': keyDef.type === 'command-action',
  'virtual-key-command-execute': keyDef.commandAction === 'execute',
  'virtual-key-hide': keyDef.type === 'hide',
});
</script>

<template>
  <div class="virtual-keyboard">
    <div class="virtual-keyboard-fixed-panel">
      <div
        v-for="row in keyRows"
        :key="row.id"
        class="virtual-keyboard-row virtual-keyboard-control-row"
      >
        <button
          v-for="keyDef in row.keys"
          :key="`${row.id}-${keyDef.label}`"
          type="button"
          class="virtual-key"
          :class="keyClass(keyDef)"
          :style="{ flexGrow: keyDef.flex ?? 1 }"
          :title="keyDef.ariaLabel ?? keyDef.label"
          :aria-label="keyDef.ariaLabel ?? keyDef.label"
          @pointerdown.prevent
          @click="sendKey(keyDef)"
        >
          <span class="virtual-key-label">{{ displayLabelFor(keyDef) }}</span>
          <span v-if="isLockKeyActive(keyDef)" class="virtual-key-lock" aria-hidden="true"></span>
        </button>
      </div>
    </div>

    <div class="virtual-keyboard-mode-tabs" role="tablist" aria-label="Keyboard mode">
      <button
        v-for="keyDef in modeTabs"
        :key="keyDef.mode"
        type="button"
        class="virtual-key virtual-key-mode-tab"
        :class="keyClass(keyDef)"
        :aria-selected="keyDef.mode === mode"
        :title="keyDef.ariaLabel ?? keyDef.label"
        :aria-label="keyDef.ariaLabel ?? keyDef.label"
        role="tab"
        @pointerdown.prevent
        @click="sendKey(keyDef)"
      >
        {{ keyDef.label }}
      </button>
    </div>

    <div class="virtual-keyboard-mode-panel" :class="`virtual-keyboard-mode-panel--${mode}`">
      <div
        v-for="row in modeRows"
        :key="row.id"
        class="virtual-keyboard-row"
      >
        <button
          v-for="keyDef in row.keys"
          :key="`${row.id}-${keyDef.label}`"
          type="button"
          class="virtual-key"
          :class="keyClass(keyDef)"
          :style="{ flexGrow: keyDef.flex ?? 1 }"
          :title="keyDef.ariaLabel ?? keyDef.label"
          :aria-label="keyDef.ariaLabel ?? keyDef.label"
          @pointerdown.prevent
          @click="sendKey(keyDef)"
        >
          <span class="virtual-key-label">{{ displayLabelFor(keyDef) }}</span>
          <span v-if="isLockKeyActive(keyDef)" class="virtual-key-lock" aria-hidden="true"></span>
        </button>
      </div>

      <div v-if="mode === 'commands'" class="virtual-keyboard-command-actions">
        <button
          v-for="keyDef in commandActionKeys"
          :key="keyDef.commandAction"
          type="button"
          class="virtual-key"
          :class="keyClass(keyDef)"
          :title="keyDef.ariaLabel ?? keyDef.label"
          :aria-label="keyDef.ariaLabel ?? keyDef.label"
          @pointerdown.prevent
          @click="sendKey(keyDef)"
        >
          {{ keyDef.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.virtual-keyboard {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  height: 100%;
  min-height: 0;
  padding: 0.38rem 0.42rem 0.48rem;
  overflow: hidden;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 82%, #1f2937);
  background: linear-gradient(180deg, color-mix(in srgb, var(--header-bg-color) 78%, #07111c), color-mix(in srgb, var(--app-bg-color) 78%, #02060d));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 -10px 24px rgba(0, 0, 0, 0.24);
  touch-action: manipulation;
}

.virtual-keyboard-fixed-panel,
.virtual-keyboard-mode-panel {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 0.24rem;
}

.virtual-keyboard-fixed-panel {
  flex: 0 0 auto;
}

.virtual-keyboard-mode-panel {
  flex: 1 1 auto;
}

.virtual-keyboard-row {
  display: flex;
  width: 100%;
  min-height: 0;
  gap: 0.24rem;
}

.virtual-keyboard-control-row {
  flex: 0 0 1.95rem;
}

.virtual-keyboard-mode-panel .virtual-keyboard-row {
  flex: 1 1 0;
}

.virtual-keyboard-mode-panel--commands .virtual-keyboard-row {
  flex: 1 1 0;
}

.virtual-keyboard-mode-tabs {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.2rem;
  padding: 0.18rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 76%, #1f2937);
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--input-bg-color) 62%, #07111c);
}

.virtual-key {
  position: relative;
  display: inline-flex;
  min-width: 0;
  min-height: 1.68rem;
  height: auto;
  flex-basis: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--border-color) 76%, #334155);
  border-radius: 0.38rem;
  background: linear-gradient(180deg, color-mix(in srgb, var(--input-bg-color) 78%, #26323d), color-mix(in srgb, var(--header-bg-color) 72%, #111827));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 2px rgba(0, 0, 0, 0.34);
  color: var(--text-color);
  font-size: 0.7rem;
  font-weight: 750;
  letter-spacing: 0;
  line-height: 1;
  text-align: center;
  user-select: none;
}

.virtual-key-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.virtual-key:active,
.virtual-key:hover {
  border-color: color-mix(in srgb, var(--link-active-color) 42%, var(--border-color));
  background: linear-gradient(180deg, color-mix(in srgb, var(--nav-item-active-bg-color) 78%, #21342a), color-mix(in srgb, var(--input-bg-color) 70%, #102016));
  color: var(--link-active-color);
}

.virtual-key-active,
.virtual-key-mode-active,
.virtual-key-template-active {
  border-color: color-mix(in srgb, var(--link-active-color) 72%, var(--border-color));
  background: linear-gradient(180deg, color-mix(in srgb, var(--button-bg-color) 78%, #1f7a3c), color-mix(in srgb, var(--button-bg-color) 62%, #0b4424));
  color: var(--button-text-color);
}

.virtual-key-control {
  color: color-mix(in srgb, var(--link-active-color) 86%, var(--text-color));
}

.virtual-key-navigation {
  font-size: 0.86rem;
}

.virtual-key-space {
  min-width: 4.5rem;
}

.virtual-key-mode-tab {
  min-height: 1.86rem;
  flex-basis: auto;
  border-radius: 0.4rem;
}

.virtual-keyboard-mode-panel--commands {
  gap: 0.3rem;
}

.virtual-keyboard-mode-panel--commands .virtual-key {
  min-height: 2.05rem;
}

.virtual-keyboard-command-actions {
  display: grid;
  flex: 0 0 2.7rem;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.32rem;
}

.virtual-key-command-action {
  min-height: 2.7rem;
  border-radius: 0.46rem;
  font-size: 0.84rem;
}

.virtual-key-command-execute {
  background: linear-gradient(180deg, color-mix(in srgb, var(--input-bg-color) 80%, #27313c), color-mix(in srgb, var(--header-bg-color) 72%, #101820));
  color: var(--text-color);
}

.virtual-key-command-execute::after {
  content: "";
  width: 0;
  height: 0;
  margin-left: 0.45rem;
  border-top: 0.28rem solid transparent;
  border-bottom: 0.28rem solid transparent;
  border-left: 0.42rem solid currentColor;
}

.virtual-key-command-action:not(.virtual-key-command-execute) {
  background: linear-gradient(180deg, color-mix(in srgb, var(--button-bg-color) 84%, #39d574), color-mix(in srgb, var(--button-bg-color) 66%, #13843c));
  color: var(--button-text-color);
}

.virtual-key-lock {
  position: absolute;
  right: 0.28rem;
  bottom: 0.25rem;
  width: 0.28rem;
  height: 0.28rem;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 22%, transparent);
}

.virtual-key-hide {
  font-size: 0.92rem;
}

@media (max-width: 420px) {
  .virtual-keyboard {
    gap: 0.24rem;
    padding: 0.34rem;
  }

  .virtual-keyboard-fixed-panel,
  .virtual-keyboard-mode-panel {
    gap: 0.22rem;
  }

  .virtual-keyboard-row {
    gap: 0.22rem;
  }

  .virtual-key {
    min-height: 1.65rem;
    border-radius: 0.36rem;
    font-size: 0.66rem;
  }

  .virtual-keyboard-control-row {
    flex-basis: 1.86rem;
  }

  .virtual-keyboard-mode-tabs {
    gap: 0.18rem;
    padding: 0.18rem;
  }
}
</style>

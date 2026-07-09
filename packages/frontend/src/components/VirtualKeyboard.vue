<script setup lang="ts">
import { computed, ref } from 'vue';
import { debugLogLazy } from '../composables/useDebugLog';

const emit = defineEmits<{
  (e: 'send-key', keySequence: string): void;
}>();

type KeyboardMode = 'letters' | 'symbols';
type KeyType = 'modifier' | 'control' | 'char' | 'navigation' | 'mode' | 'space';

interface KeyDefinition {
  label: string;
  sequence?: string;
  type: KeyType;
  flex?: number;
  mode?: KeyboardMode;
}

interface KeyRow {
  id: string;
  keys: KeyDefinition[];
}

const mode = ref<KeyboardMode>('letters');
const isCtrlActive = ref(false);
const isAltActive = ref(false);

const toggleModifier = (modifier: 'ctrl' | 'alt') => {
  if (modifier === 'ctrl') {
    isCtrlActive.value = !isCtrlActive.value;
    isAltActive.value = false;
  } else {
    isAltActive.value = !isAltActive.value;
    isCtrlActive.value = false;
  }
};

const resetModifiers = () => {
  isCtrlActive.value = false;
  isAltActive.value = false;
};

const controlSequenceFor = (keyDef: KeyDefinition) => {
  const label = keyDef.label.toUpperCase();
  if (label.length === 1 && label >= 'A' && label <= 'Z') {
    return String.fromCharCode(label.charCodeAt(0) - 'A'.charCodeAt(0) + 1);
  }
  if (label === '[' || keyDef.sequence === '\x1b') return '\x1b';
  if (label === ']') return '\x1d';
  if (label === '\\') return '\x1c';
  if (label === '?') return '\x7f';
  return keyDef.sequence ?? keyDef.label;
};

const sendKey = (keyDef: KeyDefinition) => {
  if (keyDef.type === 'mode' && keyDef.mode) {
    mode.value = keyDef.mode;
    resetModifiers();
    return;
  }

  if (keyDef.type === 'modifier') {
    toggleModifier(keyDef.label.toLowerCase() as 'ctrl' | 'alt');
    return;
  }

  let sequence = keyDef.sequence ?? keyDef.label;
  if (isCtrlActive.value) {
    sequence = controlSequenceFor(keyDef);
    debugLogLazy(() => [`[VirtualKeyboard] Sending Ctrl + ${keyDef.label} as ${JSON.stringify(sequence)}`]);
  } else if (isAltActive.value) {
    sequence = `\x1b${sequence}`;
    debugLogLazy(() => [`[VirtualKeyboard] Sending Alt + ${keyDef.label} as ${JSON.stringify(sequence)}`]);
  } else {
    debugLogLazy(() => [`[VirtualKeyboard] Sending key: ${JSON.stringify(sequence)}`]);
  }

  emit('send-key', sequence);
  resetModifiers();
};

const controlRow: KeyRow = {
  id: 'controls',
  keys: [
    { label: 'Esc', sequence: '\x1b', type: 'control' },
    { label: 'Tab', sequence: '\t', type: 'control' },
    { label: 'Ctrl+C', sequence: '\x03', type: 'control', flex: 1.25 },
    { label: 'Ctrl+D', sequence: '\x04', type: 'control', flex: 1.25 },
    { label: 'Backspace', sequence: '\x7f', type: 'control', flex: 1.6 },
    { label: 'Enter', sequence: '\r', type: 'control', flex: 1.35 },
  ],
};

const navigationRow: KeyRow = {
  id: 'navigation',
  keys: [
    { label: '←', sequence: '\x1b[D', type: 'navigation' },
    { label: '↓', sequence: '\x1b[B', type: 'navigation' },
    { label: '↑', sequence: '\x1b[A', type: 'navigation' },
    { label: '→', sequence: '\x1b[C', type: 'navigation' },
    { label: 'Home', sequence: '\x1b[H', type: 'navigation', flex: 1.15 },
    { label: 'End', sequence: '\x1b[F', type: 'navigation', flex: 1.15 },
    { label: 'PgUp', sequence: '\x1b[5~', type: 'navigation', flex: 1.15 },
    { label: 'PgDn', sequence: '\x1b[6~', type: 'navigation', flex: 1.15 },
  ],
};

const letterRows: KeyRow[] = [
  {
    id: 'numbers',
    keys: '1234567890'.split('').map(label => ({ label, type: 'char' })),
  },
  {
    id: 'qwerty',
    keys: 'qwertyuiop'.split('').map(label => ({ label, type: 'char' })),
  },
  {
    id: 'home',
    keys: 'asdfghjkl'.split('').map(label => ({ label, type: 'char' })),
  },
  {
    id: 'bottom',
    keys: [
      { label: 'Ctrl', type: 'modifier', flex: 1.15 },
      { label: 'Alt', type: 'modifier', flex: 1.15 },
      ...'zxcvbnm'.split('').map(label => ({ label, type: 'char' as const })),
      { label: 'Sym', type: 'mode', mode: 'symbols', flex: 1.15 },
    ],
  },
  {
    id: 'space',
    keys: [
      { label: '/', type: 'char' },
      { label: '-', type: 'char' },
      { label: '_', type: 'char' },
      { label: 'Space', sequence: ' ', type: 'space', flex: 4 },
      { label: '.', type: 'char' },
      { label: '~', type: 'char' },
    ],
  },
];

const symbolRows: KeyRow[] = [
  {
    id: 'symbols-top',
    keys: ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'].map(label => ({ label, type: 'char' })),
  },
  {
    id: 'shell-symbols',
    keys: ['|', ';', '&', '=', '`', '"', "'", ':'].map(label => ({ label, type: 'char' })),
  },
  {
    id: 'path-symbols',
    keys: ['/', '\\', '.', ',', '-', '_', '+', '~'].map(label => ({ label, type: 'char' })),
  },
  {
    id: 'bracket-symbols',
    keys: ['<', '>', '[', ']', '{', '}', '?', '*'].map(label => ({ label, type: 'char' })),
  },
  {
    id: 'symbol-space',
    keys: [
      { label: 'ABC', type: 'mode', mode: 'letters', flex: 1.2 },
      { label: 'Ctrl', type: 'modifier', flex: 1.15 },
      { label: 'Alt', type: 'modifier', flex: 1.15 },
      { label: 'Space', sequence: ' ', type: 'space', flex: 4 },
      { label: 'Enter', sequence: '\r', type: 'control', flex: 1.35 },
    ],
  },
];

const keyRows: KeyRow[] = [
  controlRow,
  navigationRow,
];

const modeRows = computed<KeyRow[]>(() => (mode.value === 'letters' ? letterRows : symbolRows));

const keyClass = (keyDef: KeyDefinition) => ({
  'virtual-key-active': (keyDef.label === 'Ctrl' && isCtrlActive.value) || (keyDef.label === 'Alt' && isAltActive.value),
  'virtual-key-mode-active': keyDef.type === 'mode' && keyDef.mode === mode.value,
  'virtual-key-space': keyDef.type === 'space',
  'virtual-key-control': keyDef.type === 'control',
  'virtual-key-navigation': keyDef.type === 'navigation',
});
</script>

<template>
  <div class="virtual-keyboard bg-background border-t border-border">
    <div class="virtual-keyboard-fixed-panel">
      <div
        v-for="row in keyRows"
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
          :title="keyDef.label"
          @pointerdown.prevent
          @click="sendKey(keyDef)"
        >
          {{ keyDef.label }}
        </button>
      </div>
    </div>
    <div class="virtual-keyboard-mode-panel">
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
          :title="keyDef.label"
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
  gap: 0.22rem;
  height: 100%;
  min-height: 0;
  padding: 0.32rem;
  overflow: hidden;
  touch-action: manipulation;
}

.virtual-keyboard-fixed-panel,
.virtual-keyboard-mode-panel {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  min-height: 0;
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
  gap: 0.22rem;
  min-height: 0;
}

.virtual-keyboard-mode-panel .virtual-keyboard-row {
  flex: 1 1 0;
}

.virtual-key {
  min-width: 0;
  min-height: 1.8rem;
  height: auto;
  flex-basis: 0;
  border: 1px solid var(--border-color);
  border-radius: 0.36rem;
  background: var(--input-bg-color);
  color: var(--text-color);
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  user-select: none;
}

.virtual-key:active,
.virtual-key:hover {
  background: var(--nav-item-active-bg-color);
}

.virtual-key-active,
.virtual-key-mode-active {
  border-color: var(--link-active-color);
  background: var(--button-bg-color);
  color: var(--button-text-color);
}

.virtual-key-control {
  color: var(--link-active-color);
}

.virtual-key-navigation {
  font-size: 0.86rem;
}

.virtual-key-space {
  min-width: 4.8rem;
}
</style>

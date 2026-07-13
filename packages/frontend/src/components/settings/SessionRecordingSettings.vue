<template>
  <section class="space-y-4">
    <div class="flex items-center justify-between gap-3 border-b border-border pb-2">
      <div>
        <h2 class="text-xl font-semibold">{{ t('sessionRecording.title') }}</h2>
        <p class="text-sm text-text-secondary">{{ t('sessionRecording.description') }}</p>
      </div>
      <button class="px-3 py-2 rounded bg-button text-button-text" type="button" :disabled="loading" @click="loadList">
        {{ t('common.refresh') }}
      </button>
    </div>

    <p v-if="error" class="p-3 border border-error text-error rounded">{{ error }}</p>
    <div v-else class="grid gap-4 lg:grid-cols-[minmax(20rem,0.8fr)_minmax(26rem,1.2fr)]">
      <div class="border border-border rounded overflow-auto max-h-[34rem]">
        <button
          v-for="recording in recordingList"
          :key="recording.id"
          type="button"
          :class="['block w-full p-3 text-left border-b border-border hover:bg-header/50', { 'bg-header': selectedId === recording.id }]"
          @click="selectRecording(recording.id)"
        >
          <span class="flex justify-between gap-2"><strong>{{ recording.connection_name }}</strong><span>{{ recording.protocol }}</span></span>
          <span class="block text-xs text-text-secondary mt-1">{{ recording.username || '-' }} · {{ formatTime(recording.started_at) }}</span>
          <span class="block text-xs mt-1" :class="recording.status === 'completed' ? 'text-success' : 'text-warning'">
            {{ t(`sessionRecording.status.${recording.status}`) }} · {{ recording.event_count }}
          </span>
        </button>
        <p v-if="!loading && recordingList.length === 0" class="p-4 text-text-secondary">{{ t('sessionRecording.empty') }}</p>
      </div>

      <div class="space-y-2 min-w-0">
        <div class="flex items-center gap-2">
          <button type="button" class="px-3 py-2 rounded bg-button text-button-text disabled:opacity-50" :disabled="!selectedId || playing" @click="play">
            {{ t('sessionRecording.play') }}
          </button>
          <button type="button" class="px-3 py-2 rounded border border-border disabled:opacity-50" :disabled="!playing" @click="stop">
            {{ t('sessionRecording.stop') }}
          </button>
          <label class="text-sm text-text-secondary" for="recording-speed">{{ t('sessionRecording.speed') }}</label>
          <select id="recording-speed" v-model.number="speed" class="px-2 py-2 bg-background border border-border rounded">
            <option :value="1">1×</option><option :value="2">2×</option><option :value="4">4×</option><option :value="8">8×</option>
          </select>
        </div>
        <div ref="terminalHost" class="h-[30rem] min-w-0 rounded border border-border bg-black p-1" :aria-label="t('sessionRecording.player')"></div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { sessionRecordingApi, type SessionRecording, type SessionRecordingEvent } from '../../services/sessionRecording.api';

const { t } = useI18n();
const recordingList = ref<SessionRecording[]>([]);
const selectedId = ref('');
const loading = ref(false);
const playing = ref(false);
const speed = ref(4);
const error = ref('');
const terminalHost = ref<HTMLElement>();
let terminal: Terminal | undefined;
let fitAddon: FitAddon | undefined;
let playGeneration = 0;

const formatTime = (timestamp: number) => new Date(timestamp).toLocaleString();
const sleep = (duration: number) => new Promise(resolve => setTimeout(resolve, duration));
const decode = (data: string): Uint8Array => Uint8Array.from(atob(data), char => char.charCodeAt(0));

const loadList = async () => {
  loading.value = true;
  error.value = '';
  try { recordingList.value = await sessionRecordingApi.list(); }
  catch { error.value = t('sessionRecording.loadFailed'); }
  finally { loading.value = false; }
};

const ensureTerminal = async () => {
  if (terminal || !terminalHost.value) return;
  terminal = new Terminal({ convertEol: false, cursorBlink: false, disableStdin: true, scrollback: 10_000 });
  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalHost.value);
  await nextTick();
  fitAddon.fit();
};

const selectRecording = async (id: string) => {
  stop();
  selectedId.value = id;
  await ensureTerminal();
  terminal?.reset();
};

const renderEvent = (event: SessionRecordingEvent) => {
  if (!terminal) return;
  if (event.type === 'output') terminal.write(decode(event.data));
  else if (event.type === 'resize') terminal.resize(Math.max(2, event.cols), Math.max(1, event.rows));
};

const play = async () => {
  if (!selectedId.value) return;
  await ensureTerminal();
  terminal?.reset();
  const generation = ++playGeneration;
  playing.value = true;
  error.value = '';
  let cursor: number | null = 0;
  let previousOffset = 0;
  try {
    while (cursor !== null && generation === playGeneration) {
      const page = await sessionRecordingApi.read(selectedId.value, cursor);
      for (const event of page.eventList) {
        if (generation !== playGeneration) return;
        const delay = Math.min(1_000, Math.max(0, event.offsetMs - previousOffset)) / speed.value;
        if (delay > 0) await sleep(delay);
        renderEvent(event);
        previousOffset = event.offsetMs;
      }
      cursor = page.nextCursor;
    }
  } catch { error.value = t('sessionRecording.playFailed'); }
  finally { if (generation === playGeneration) playing.value = false; }
};

const stop = () => { playGeneration += 1; playing.value = false; };
onMounted(loadList);
onBeforeUnmount(() => { stop(); terminal?.dispose(); });
</script>

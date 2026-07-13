<template>
  <section class="recording-workspace">
    <form class="recording-filters" @submit.prevent="applyFilters">
      <label><span>{{ t('common.search') }}</span><input v-model="filterQuery" :placeholder="t('sessionRecording.searchPlaceholder', '连接或用户名')"></label>
      <label><span>{{ t('accessControl.status') }}</span><select v-model="filterStatus"><option value="">{{ t('common.all') }}</option><option value="completed">{{ t('sessionRecording.status.completed') }}</option><option value="active">{{ t('sessionRecording.status.active') }}</option><option value="incomplete">{{ t('sessionRecording.status.incomplete') }}</option><option value="failed">{{ t('sessionRecording.status.failed') }}</option></select></label>
      <label><span>{{ t('sessionRecording.startedAfter', '开始时间') }}</span><input v-model="filterStartedAfter" type="datetime-local"></label>
      <button type="submit" :disabled="loading"><i class="fas fa-search"></i>{{ t('common.search') }}</button>
      <button type="button" class="secondary" :disabled="loading" @click="resetFilters">{{ t('common.reset') }}</button>
    </form>

    <p v-if="error" role="alert" class="recording-message">{{ error }}</p>
    <div class="recording-layout">
      <aside class="recording-list" :aria-busy="loading">
        <header><strong>{{ t('sessionRecording.title') }}</strong><span>{{ t('sessionRecording.total', { count: total }) }}</span></header>
        <button v-for="recording in recordingList" :key="recording.id" type="button" :class="{ active: selectedId === recording.id }" @click="selectRecording(recording.id)">
          <span><strong>{{ recording.connection_name }}</strong><em>{{ recording.protocol }}</em></span>
          <small>{{ recording.username || '-' }} · {{ formatTime(recording.started_at) }}</small>
          <small><i :class="`status-dot ${recording.status}`"></i>{{ t(`sessionRecording.status.${recording.status}`) }} · {{ recording.event_count }} events</small>
        </button>
        <p v-if="!loading && !recordingList.length" class="empty-state">{{ t('sessionRecording.empty') }}</p>
        <footer><button type="button" :disabled="currentPage <= 1 || loading" @click="changePage(-1)"><i class="fas fa-chevron-left"></i></button><span>{{ currentPage }} / {{ pageCount }}</span><button type="button" :disabled="currentPage >= pageCount || loading" @click="changePage(1)"><i class="fas fa-chevron-right"></i></button></footer>
      </aside>

      <article class="recording-player">
        <template v-if="selectedRecording">
          <header class="recording-detail"><div><h3>{{ selectedRecording.connection_name }}</h3><p>{{ selectedRecording.username || '-' }} · {{ selectedRecording.protocol }}</p></div><dl><div><dt>{{ t('sessionRecording.duration', '时长') }}</dt><dd>{{ formatDuration(durationMs) }}</dd></div><div><dt>{{ t('sessionRecording.events', '事件') }}</dt><dd>{{ selectedRecording.event_count }}</dd></div><div><dt>{{ t('sessionRecording.size', '大小') }}</dt><dd>{{ formatBytes(selectedRecording.byte_count) }}</dd></div></dl></header>
          <div class="player-toolbar"><button type="button" :disabled="preparing" @click="playing ? stop() : play()"><i :class="playing ? 'fas fa-pause' : 'fas fa-play'"></i>{{ playing ? t('sessionRecording.stop') : t('sessionRecording.play') }}</button><label>{{ t('sessionRecording.speed') }}<select v-model.number="speed"><option :value="1">1×</option><option :value="2">2×</option><option :value="4">4×</option><option :value="8">8×</option></select></label><span v-if="preparing">{{ t('sessionRecording.preparing', '正在准备回放…') }}</span></div>
          <div ref="terminalHost" class="terminal-host" :aria-label="t('sessionRecording.player')"></div>
          <div class="timeline"><input v-model.number="timelineOffset" type="range" min="0" :max="Math.max(1, durationMs)" step="100" :disabled="preparing" :aria-label="t('sessionRecording.timeline', '回放时间轴')" @input="seekTo(timelineOffset)"><span>{{ formatDuration(timelineOffset) }} / {{ formatDuration(durationMs) }}</span></div>
        </template>
        <div v-else class="player-placeholder"><i class="fas fa-video"></i><p>{{ t('sessionRecording.selectHint', '选择一条录像查看详情并回放。') }}</p></div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { sessionRecordingApi, type SessionRecording, type SessionRecordingEvent, type SessionRecordingListQuery } from '../../services/sessionRecording.api';

const { t } = useI18n();
const PAGE_SIZE = 25;
const recordingList = ref<SessionRecording[]>([]);
const total = ref(0);
const currentPage = ref(1);
const selectedId = ref('');
const loading = ref(false);
const preparing = ref(false);
const playing = ref(false);
const speed = ref(2);
const error = ref('');
const filterQuery = ref('');
const filterStatus = ref<'' | NonNullable<SessionRecordingListQuery['status']>>('');
const filterStartedAfter = ref('');
const timelineOffset = ref(0);
const terminalHost = ref<HTMLElement>();
const cachedEvents = ref<SessionRecordingEvent[]>([]);
let terminal: Terminal | undefined;
let fitAddon: FitAddon | undefined;
let resizeObserver: ResizeObserver | undefined;
let playGeneration = 0;

const selectedRecording = computed(() => recordingList.value.find(item => item.id === selectedId.value));
const durationMs = computed(() => selectedRecording.value ? Math.max(0, (selectedRecording.value.ended_at ?? Date.now()) - selectedRecording.value.started_at) : 0);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const formatTime = (value: number) => new Date(value).toLocaleString();
const formatDuration = (value: number) => `${Math.floor(value / 60000).toString().padStart(2, '0')}:${Math.floor(value % 60000 / 1000).toString().padStart(2, '0')}`;
const formatBytes = (value: number) => value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`;
const decode = (data: string) => Uint8Array.from(atob(data), char => char.charCodeAt(0));
const sleep = (duration: number) => new Promise(resolve => window.setTimeout(resolve, duration));

const loadList = async () => {
  loading.value = true; error.value = '';
  try {
    const page = await sessionRecordingApi.list({ query: filterQuery.value || undefined, status: filterStatus.value || undefined, startedAfter: filterStartedAfter.value ? new Date(filterStartedAfter.value).getTime() : undefined, limit: PAGE_SIZE, offset: (currentPage.value - 1) * PAGE_SIZE });
    recordingList.value = page.itemList; total.value = page.total;
    if (selectedId.value && !recordingList.value.some(item => item.id === selectedId.value)) selectedId.value = '';
  } catch { error.value = t('sessionRecording.loadFailed'); }
  finally { loading.value = false; }
};
const applyFilters = () => { currentPage.value = 1; void loadList(); };
const resetFilters = () => { filterQuery.value = ''; filterStatus.value = ''; filterStartedAfter.value = ''; applyFilters(); };
const changePage = (delta: number) => { currentPage.value += delta; void loadList(); };

const ensureTerminal = async () => {
  if (terminal || !terminalHost.value) return;
  terminal = new Terminal({ convertEol: false, cursorBlink: false, disableStdin: true, scrollback: 10_000 });
  fitAddon = new FitAddon(); terminal.loadAddon(fitAddon); terminal.open(terminalHost.value);
  await nextTick(); fitAddon.fit();
  resizeObserver = new ResizeObserver(() => fitAddon?.fit()); resizeObserver.observe(terminalHost.value);
};
const renderEvent = (event: SessionRecordingEvent) => { if (event.type === 'output') terminal?.write(decode(event.data)); else if (event.type === 'resize') terminal?.resize(Math.max(2, event.cols), Math.max(1, event.rows)); };
const loadEvents = async () => {
  if (!selectedId.value || cachedEvents.value.length) return;
  preparing.value = true;
  try { let cursor: number | null = 0; while (cursor !== null) { const page = await sessionRecordingApi.read(selectedId.value, cursor); cachedEvents.value.push(...page.eventList); cursor = page.nextCursor; } }
  catch { error.value = t('sessionRecording.playFailed'); }
  finally { preparing.value = false; }
};
const selectRecording = async (id: string) => { stop(); selectedId.value = id; cachedEvents.value = []; timelineOffset.value = 0; await nextTick(); await ensureTerminal(); terminal?.reset(); void loadEvents(); };
const seekTo = (offset: number) => { stop(); terminal?.reset(); for (const event of cachedEvents.value) { if (event.offsetMs > offset) break; renderEvent(event); } timelineOffset.value = offset; };
const play = async () => {
  await ensureTerminal(); await loadEvents(); if (!cachedEvents.value.length) return;
  const generation = ++playGeneration; playing.value = true; let previous = timelineOffset.value;
  try { for (const event of cachedEvents.value) { if (event.offsetMs < timelineOffset.value) continue; if (generation !== playGeneration) return; const delay = Math.min(1000, Math.max(0, event.offsetMs - previous)) / speed.value; if (delay) await sleep(delay); if (generation !== playGeneration) return; renderEvent(event); timelineOffset.value = event.offsetMs; previous = event.offsetMs; } }
  finally { if (generation === playGeneration) playing.value = false; }
};
const stop = () => { playGeneration += 1; playing.value = false; };
onMounted(loadList);
onBeforeUnmount(() => { stop(); resizeObserver?.disconnect(); terminal?.dispose(); });
</script>

<style scoped>
.recording-workspace{display:grid;gap:1rem}.recording-filters{display:flex;align-items:end;gap:.65rem;flex-wrap:wrap;padding:1rem;border:1px solid var(--border);border-radius:.75rem;background:var(--card)}.recording-filters label{display:grid;gap:.3rem;flex:1;min-width:11rem}.recording-filters label span{font-size:.75rem;color:var(--muted-foreground)}input,select,button{border:1px solid var(--border);border-radius:.45rem;padding:.55rem .7rem;background:var(--background);color:var(--foreground)}button{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;background:var(--primary);color:var(--primary-foreground);cursor:pointer}.secondary{background:var(--background);color:var(--foreground)}button:disabled{opacity:.5}.recording-message{padding:.7rem;border:1px solid var(--destructive);border-radius:.5rem;color:var(--destructive)}.recording-layout{display:grid;grid-template-columns:minmax(18rem,.72fr) minmax(28rem,1.28fr);min-height:35rem;border:1px solid var(--border);border-radius:.75rem;overflow:hidden}.recording-list{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--border);background:var(--background)}.recording-list>header,.recording-list>footer{display:flex;justify-content:space-between;align-items:center;padding:.8rem;border-bottom:1px solid var(--border)}.recording-list>header span,.recording-list small{color:var(--muted-foreground);font-size:.75rem}.recording-list>button{display:grid;gap:.35rem;padding:.8rem;border:0;border-bottom:1px solid var(--border);border-radius:0;background:transparent;color:var(--foreground);text-align:left}.recording-list>button:hover,.recording-list>button.active{background:var(--accent)}.recording-list>button.active{box-shadow:inset 3px 0 var(--primary)}.recording-list>button>span{display:flex;justify-content:space-between}.recording-list em{font-style:normal;color:var(--primary);font-size:.75rem}.status-dot{display:inline-block;width:.45rem;height:.45rem;margin-right:.35rem;border-radius:50%;background:var(--muted-foreground)}.status-dot.completed{background:var(--success)}.status-dot.active{background:var(--primary)}.status-dot.incomplete,.status-dot.failed{background:var(--warning)}.recording-list>footer{margin-top:auto;border-top:1px solid var(--border);border-bottom:0}.recording-list>footer button{padding:.4rem .6rem}.empty-state,.player-placeholder{display:grid;place-content:center;gap:.6rem;min-height:15rem;text-align:center;color:var(--muted-foreground)}.recording-player{display:flex;flex-direction:column;min-width:0;padding:1rem;gap:.8rem}.recording-detail{display:flex;justify-content:space-between;gap:1rem}.recording-detail h3,.recording-detail p{margin:0}.recording-detail p{color:var(--muted-foreground)}.recording-detail dl{display:flex;gap:1.2rem;margin:0}.recording-detail dl div{display:grid}.recording-detail dt{font-size:.7rem;color:var(--muted-foreground)}.recording-detail dd{margin:0}.player-toolbar{display:flex;align-items:center;gap:.7rem}.player-toolbar label{display:flex;align-items:center;gap:.4rem}.terminal-host{height:27rem;min-width:0;padding:.25rem;border:1px solid var(--border);border-radius:.5rem;background:#000}.timeline{display:flex;align-items:center;gap:.8rem}.timeline input{flex:1;padding:0}.timeline span{font-variant-numeric:tabular-nums;font-size:.8rem}@media(max-width:900px){.recording-layout{grid-template-columns:1fr}.recording-list{max-height:25rem;border-right:0;border-bottom:1px solid var(--border)}.recording-detail{flex-direction:column}}@media(max-width:600px){.recording-detail dl{display:grid;grid-template-columns:repeat(3,1fr)}.terminal-host{height:22rem}}
</style>

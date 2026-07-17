<template>
  <section class="recording-workspace">
    <form class="recording-filters" @submit.prevent="applyFilters">
      <label><span>{{ t('common.search') }}</span><input v-model="filterQuery" :placeholder="t('sessionRecording.searchPlaceholder')"></label>
      <label><span>{{ t('accessControl.status') }}</span><select v-model="filterStatus"><option value="">{{ t('common.all') }}</option><option value="completed">{{ t('sessionRecording.status.completed') }}</option><option value="active">{{ t('sessionRecording.status.active') }}</option><option value="incomplete">{{ t('sessionRecording.status.incomplete') }}</option><option value="failed">{{ t('sessionRecording.status.failed') }}</option></select></label>
      <AdminDateRange v-model:start="filterStartedAfter" v-model:end="filterStartedBefore" :label="t('adminDateRange.range')" />
      <button type="submit" :disabled="loading"><i class="fas fa-search"></i>{{ t('common.search') }}</button>
      <button type="button" class="secondary" :disabled="loading" @click="resetFilters">{{ t('common.reset') }}</button>
    </form>

    <p v-if="error" role="alert" class="recording-message">{{ error }}</p>
    <div class="recording-layout">
      <aside class="recording-list" :aria-busy="loading">
        <header><strong>{{ t('sessionRecording.title') }}</strong><span>{{ t('sessionRecording.total', { count: total }) }}</span></header>
        <article v-for="recording in recordingList" :key="recording.id" class="recording-item">
          <button type="button" class="recording-open" @click="selectRecording(recording.id)">
            <span class="recording-primary"><strong>{{ recording.connection_name }}</strong><em>{{ recording.protocol }}</em></span>
            <span class="recording-owner"><i class="fas fa-user"></i><small>{{ recording.username || '-' }}</small><small>{{ formatTime(recording.started_at) }}</small></span>
            <span class="recording-state"><i :class="`status-dot ${recording.status}`"></i><small>{{ t(`sessionRecording.status.${recording.status}`) }}</small><small>{{ t('sessionRecording.eventCount', { count: recording.event_count }) }}</small></span>
          </button>
          <button type="button" class="delete-recording danger" :disabled="recording.status === 'active' || deletingId === recording.id" :aria-label="t('sessionRecording.delete')" @click="deleteRecording(recording)"><i class="fas fa-trash"></i></button>
        </article>
        <p v-if="!loading && !recordingList.length" class="empty-state">{{ t('sessionRecording.empty') }}</p>
        <AdminPagination :page="currentPage" :page-count="pageCount" :total="total" :disabled="loading" @update:page="setPage" />
      </aside>

      <div v-if="selectedRecording" ref="recordingDialogRootRef" class="recording-modal" role="dialog" aria-modal="true" :aria-label="t('sessionRecording.player')" @click.self="closePlayer">
        <article ref="recordingDialogRef" class="recording-player" :class="{ 'recording-player--expanded': recordingPlayerExpanded }">
          <header class="recording-detail recording-drag-handle" @pointerdown="startRecordingDialogDrag"><div><h3>{{ selectedRecording.connection_name }}</h3><p>{{ selectedRecording.username || '-' }} · {{ selectedRecording.protocol }}</p></div><dl><div><dt>{{ t('sessionRecording.duration') }}</dt><dd>{{ formatDuration(playbackDurationMs) }}</dd></div><div><dt>{{ t('sessionRecording.events') }}</dt><dd>{{ selectedRecording.event_count }}</dd></div><div><dt>{{ t('sessionRecording.size') }}</dt><dd>{{ formatBytes(selectedRecording.byte_count) }}</dd></div></dl><div class="modal-actions" data-dialog-no-drag><button type="button" :aria-label="t(recordingPlayerExpanded ? 'sessionRecording.restorePlayer' : 'sessionRecording.expandPlayer')" :aria-pressed="recordingPlayerExpanded" @click="toggleRecordingPlayerExpanded"><i :class="recordingPlayerExpanded ? 'fas fa-window-restore' : 'fas fa-window-maximize'"></i></button><button type="button" class="modal-close" :aria-label="t('common.close')" @click="closePlayer"><i class="fas fa-xmark"></i></button></div></header>
          <div class="player-toolbar"><button type="button" :disabled="preparing || hasInvalidRecordingIntegrity() || (isRemoteDesktopRecording && !remoteDesktopRecordingReady)" @click="playing ? stop() : play()"><i :class="playing ? 'fas fa-pause' : 'fas fa-play'"></i>{{ playing ? t('sessionRecording.stop') : t('sessionRecording.play') }}</button><label>{{ t('sessionRecording.speed') }}<select v-model.number="speed" @change="handlePlaybackSpeedChange"><option :value="1">1×</option><option :value="2">2×</option><option :value="4">4×</option><option :value="8">8×</option></select></label><span v-if="preparing">{{ t('sessionRecording.preparing', '正在准备回放…') }}</span></div>
          <p v-if="recordingIntegrity?.status === 'invalid'" role="alert" class="recording-message">{{ t('sessionRecording.integrity.invalid') }}</p>
          <div v-if="isRemoteDesktopRecording" ref="remoteDesktopRecordingHost" class="terminal-host remote-desktop-recording-host" :aria-label="t('sessionRecording.player')"></div>
          <div v-else ref="terminalHost" class="terminal-host" :aria-label="t('sessionRecording.player')"></div>
          <div class="timeline"><input v-model.number="timelineOffset" type="range" min="0" :max="Math.max(1, playbackDurationMs)" step="100" :disabled="preparing || hasInvalidRecordingIntegrity()" :aria-label="t('sessionRecording.timeline', '回放时间轴')" @input="seekTo(timelineOffset)"><span>{{ formatDuration(timelineOffset) }} / {{ formatDuration(playbackDurationMs) }}</span></div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
// @ts-ignore - guacamole-common-js does not publish TypeScript declarations.
import Guacamole from 'guacamole-common-js';
import { sessionRecordingApi, type SessionRecording, type SessionRecordingEvent, type SessionRecordingIntegrity, type SessionRecordingListQuery } from '../../services/sessionRecording.api';
import AdminPagination from '../admin/AdminPagination.vue';
import AdminDateRange from '../admin/AdminDateRange.vue';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import { useDraggableDialog } from '../../composables/useDraggableDialog';

const { t } = useI18n();
const route = useRoute();
const { showConfirmDialog } = useConfirmDialog();
const PAGE_SIZE = 25;
const MAX_CACHED_EVENTS = 1000;
const recordingList = ref<SessionRecording[]>([]);
const total = ref(0);
const currentPage = ref(1);
const selectedId = ref('');
const loading = ref(false);
const preparing = ref(false);
const playing = ref(false);
const speed = ref(2);
const error = ref('');
const deletingId = ref('');
const filterQuery = ref('');
const filterStatus = ref<'' | NonNullable<SessionRecordingListQuery['status']>>('');
const filterStartedAfter = ref('');
const filterStartedBefore = ref('');
const timelineOffset = ref(0);
const terminalHost = ref<HTMLElement>();
const remoteDesktopRecordingHost = ref<HTMLElement>();
const recordingDialogRootRef = ref<HTMLElement | null>(null);
const recordingDialogRef = ref<HTMLElement | null>(null);
const cachedEvents = ref<SessionRecordingEvent[]>([]);
const recordingIntegrity = ref<SessionRecordingIntegrity>();
const recordingPlayerExpanded = ref(false);
const hasInvalidRecordingIntegrity = () => recordingIntegrity.value?.status === 'invalid';
const { centerDialog: centerRecordingDialog, startDialogDrag: startRecordingDialogDrag } = useDraggableDialog({
  rootRef: recordingDialogRootRef,
  dialogRef: recordingDialogRef,
  disabled: () => window.innerWidth <= 768 || recordingPlayerExpanded.value,
  resizable: false,
  margin: 12,
});
let terminal: Terminal | undefined;
let fitAddon: FitAddon | undefined;
let resizeObserver: ResizeObserver | undefined;
let playGeneration = 0;
let recordedTerminalSize: { cols: number; rows: number } | undefined;
let nextEventCursor: number | null = 0;
let cacheStartCursor = 0;
let recordingAbortController: AbortController | undefined;
let remoteDesktopRecording: any | undefined;
let remoteDesktopResizeObserver: ResizeObserver | undefined;
let remoteDesktopSpeedTimer: number | undefined;
let remoteDesktopSpeedAnchor: { position: number; timestamp: number } | undefined;
let remoteDesktopSpeedSeekInProgress = false;
const remoteDesktopPlaybackDurationMs = ref(0);
const remoteDesktopRecordingReady = ref(false);

const selectedRecording = computed(() => recordingList.value.find(item => item.id === selectedId.value));
const isRemoteDesktopRecording = computed(() => ['RDP', 'VNC'].includes(selectedRecording.value?.protocol ?? ''));
const durationMs = computed(() => selectedRecording.value ? Math.max(0, (selectedRecording.value.ended_at ?? Date.now()) - selectedRecording.value.started_at) : 0);
const playbackDurationMs = computed(() => isRemoteDesktopRecording.value
  ? Math.max(remoteDesktopPlaybackDurationMs.value, durationMs.value)
  : cachedEvents.value[cachedEvents.value.length - 1]?.offsetMs ?? durationMs.value);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const formatTime = (value: number) => new Date(value).toLocaleString();
const formatDuration = (value: number) => `${Math.floor(value / 60000).toString().padStart(2, '0')}:${Math.floor(value % 60000 / 1000).toString().padStart(2, '0')}`;
const formatBytes = (value: number) => value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`;
const decode = (data: string) => Uint8Array.from(atob(data), char => char.charCodeAt(0));
const sleep = (duration: number) => new Promise(resolve => window.setTimeout(resolve, duration));

const loadList = async () => {
  loading.value = true; error.value = '';
  try {
    const page = await sessionRecordingApi.list({ query: filterQuery.value || undefined, status: filterStatus.value || undefined, startedAfter: filterStartedAfter.value ? new Date(`${filterStartedAfter.value}T00:00:00`).getTime() : undefined, startedBefore: filterStartedBefore.value ? new Date(`${filterStartedBefore.value}T23:59:59.999`).getTime() : undefined, limit: PAGE_SIZE, offset: (currentPage.value - 1) * PAGE_SIZE });
    recordingList.value = page.itemList; total.value = page.total;
    if (selectedId.value && !recordingList.value.some(item => item.id === selectedId.value)) selectedId.value = '';
  } catch { error.value = t('sessionRecording.loadFailed'); }
  finally { loading.value = false; }
};
const applyFilters = () => { currentPage.value = 1; void loadList(); };
const resetFilters = () => { filterQuery.value = ''; filterStatus.value = ''; filterStartedAfter.value = ''; filterStartedBefore.value = ''; applyFilters(); };
const setPage = (page: number) => { currentPage.value = page; void loadList(); };

const clearTerminalViewportStyles = () => {
  const xtermElement = terminalHost.value?.querySelector<HTMLElement>('.xterm');
  if (!xtermElement) return;
  xtermElement.style.width = '';
  xtermElement.style.height = '';
  xtermElement.style.transform = '';
};

const syncTerminalViewport = () => {
  clearTerminalViewportStyles();
  if (!recordedTerminalSize) {
    fitAddon?.fit();
    return;
  }
  terminal?.resize(recordedTerminalSize.cols, recordedTerminalSize.rows);
  terminal?.refresh(0, recordedTerminalSize.rows - 1);
};

// 旧录像可能先记录输出、后记录首次 resize。回放前先采用首个尺寸，避免历史输出按弹窗宽度重排。
const primeTerminalForReplay = () => {
  const initialResize = cachedEvents.value.find(event => event.type === 'resize');
  recordedTerminalSize = initialResize
    ? { cols: Math.max(2, initialResize.cols), rows: Math.max(1, initialResize.rows) }
    : undefined;
  syncTerminalViewport();
};

const ensureTerminal = async () => {
  if (terminal || !terminalHost.value) return;
  terminal = new Terminal({ convertEol: false, cursorBlink: false, disableStdin: true, scrollback: 10_000 });
  fitAddon = new FitAddon(); terminal.loadAddon(fitAddon); terminal.open(terminalHost.value);
  await nextTick(); fitAddon.fit();
  resizeObserver = new ResizeObserver(syncTerminalViewport); resizeObserver.observe(terminalHost.value);
};
const syncRemoteDesktopReplayDisplay = () => {
  const host = remoteDesktopRecordingHost.value;
  const display = remoteDesktopRecording?.getDisplay?.();
  if (!host || !display) return;

  const displayWidth = Number(display.getWidth?.() ?? 0);
  const displayHeight = Number(display.getHeight?.() ?? 0);
  const hostWidth = host.clientWidth;
  const hostHeight = host.clientHeight;
  if (displayWidth <= 0 || displayHeight <= 0 || hostWidth <= 0 || hostHeight <= 0) return;

  display.scale(Math.min(hostWidth / displayWidth, hostHeight / displayHeight));
  const displayElement = display.getElement?.() as HTMLElement | undefined;
  if (displayElement) displayElement.style.margin = 'auto';
};
const stopRemoteDesktopSpeedController = () => {
  if (remoteDesktopSpeedTimer !== undefined) window.clearInterval(remoteDesktopSpeedTimer);
  remoteDesktopSpeedTimer = undefined;
  remoteDesktopSpeedAnchor = undefined;
  remoteDesktopSpeedSeekInProgress = false;
};
// Guacamole 的 SessionRecording 没有 playbackRate；倍速时定期向前 seek，仍由其自身完成关键帧恢复和画面渲染。
const startRemoteDesktopSpeedController = () => {
  stopRemoteDesktopSpeedController();
  if (!remoteDesktopRecording || speed.value <= 1 || !playing.value) return;

  remoteDesktopSpeedAnchor = {
    position: Number(remoteDesktopRecording.getPosition?.() ?? timelineOffset.value),
    timestamp: performance.now(),
  };
  remoteDesktopSpeedTimer = window.setInterval(() => {
    if (!remoteDesktopRecording || !remoteDesktopSpeedAnchor || !playing.value || remoteDesktopSpeedSeekInProgress) return;

    const targetPosition = Math.min(
      remoteDesktopPlaybackDurationMs.value,
      remoteDesktopSpeedAnchor.position + (performance.now() - remoteDesktopSpeedAnchor.timestamp) * speed.value,
    );
    const currentPosition = Number(remoteDesktopRecording.getPosition?.() ?? timelineOffset.value);
    if (targetPosition - currentPosition < 100) return;

    remoteDesktopSpeedSeekInProgress = true;
    remoteDesktopRecording?.seek(targetPosition);
  }, 100);
};
const handlePlaybackSpeedChange = () => {
  if (isRemoteDesktopRecording.value) startRemoteDesktopSpeedController();
};
const toggleRecordingPlayerExpanded = async () => {
  recordingPlayerExpanded.value = !recordingPlayerExpanded.value;
  await nextTick();
  syncRemoteDesktopReplayDisplay();
  if (!recordingPlayerExpanded.value) await centerRecordingDialog();
};
const ensureRemoteDesktopRecording = async () => {
  if (!isRemoteDesktopRecording.value || !remoteDesktopRecordingHost.value || remoteDesktopRecording) return;
  preparing.value = true;
  remoteDesktopRecordingReady.value = false;
  const tunnelUrl = new URL(`/api/v1/session-recordings/${selectedId.value}/guacamole`, window.location.origin).toString();
  const tunnel = new Guacamole.StaticHTTPTunnel(tunnelUrl);
  const recording = new Guacamole.SessionRecording(tunnel);
  remoteDesktopRecording = recording;
  remoteDesktopRecordingHost.value.replaceChildren(recording.getDisplay().getElement());
  remoteDesktopResizeObserver?.disconnect();
  remoteDesktopResizeObserver = new ResizeObserver(syncRemoteDesktopReplayDisplay);
  remoteDesktopResizeObserver.observe(remoteDesktopRecordingHost.value);
  recording.onprogress = (duration: number) => {
    remoteDesktopPlaybackDurationMs.value = duration;
    syncRemoteDesktopReplayDisplay();
  };
  recording.onload = () => {
    remoteDesktopPlaybackDurationMs.value = recording.getDuration();
    syncRemoteDesktopReplayDisplay();
    remoteDesktopRecordingReady.value = true;
    preparing.value = false;
  };
  recording.onplay = () => { remoteDesktopSpeedSeekInProgress = false; playing.value = true; };
  recording.onpause = () => {
    if (remoteDesktopSpeedSeekInProgress) return;
    stopRemoteDesktopSpeedController();
    playing.value = false;
  };
  recording.onseek = (position: number) => { timelineOffset.value = position; };
  recording.onerror = () => {
    stopRemoteDesktopSpeedController();
    playing.value = false;
    preparing.value = false;
    remoteDesktopRecordingReady.value = false;
    error.value = t('sessionRecording.remoteDesktopPlaybackFailed');
  };
  recording.connect();
};
const renderEvent = (event: SessionRecordingEvent) => {
  if (event.type === 'output') {
    terminal?.write(decode(event.data));
    return;
  }
  if (event.type === 'resize') {
    recordedTerminalSize = { cols: Math.max(2, event.cols), rows: Math.max(1, event.rows) };
    terminal?.resize(recordedTerminalSize.cols, recordedTerminalSize.rows);
    syncTerminalViewport();
  }
};
const loadNextEventPage = async (reset = false) => {
  if (!selectedId.value || (!reset && nextEventCursor === null)) return false;
  if (reset) { cachedEvents.value = []; nextEventCursor = 0; cacheStartCursor = 0; }
  const recordingId = selectedId.value;
  const cursor = nextEventCursor ?? 0;
  recordingAbortController ??= new AbortController();
  const page = await sessionRecordingApi.read(recordingId, cursor, recordingAbortController.signal);
  if (recordingId !== selectedId.value) return false;
  recordingIntegrity.value = page.integrity;
  if (page.integrity.status === 'invalid') return false;
  cachedEvents.value.push(...page.eventList);
  nextEventCursor = page.nextCursor;
  if (cachedEvents.value.length > MAX_CACHED_EVENTS) {
    const removedCount = cachedEvents.value.length - MAX_CACHED_EVENTS;
    cachedEvents.value.splice(0, removedCount);
    cacheStartCursor += removedCount;
  }
  return page.eventList.length > 0;
};
const loadEvents = async () => {
  if (!selectedId.value || cachedEvents.value.length) return;
  preparing.value = true;
  try { await loadNextEventPage(); }
  catch (requestError) { const canceled = requestError instanceof DOMException && requestError.name === 'AbortError' || Boolean(requestError && typeof requestError === 'object' && 'code' in requestError && requestError.code === 'ERR_CANCELED'); if (!canceled) error.value = t('sessionRecording.playFailed'); }
  finally { preparing.value = false; }
};
const selectRecording = async (id: string) => { stop(); remoteDesktopRecording?.abort(); remoteDesktopRecording = undefined; remoteDesktopResizeObserver?.disconnect(); remoteDesktopResizeObserver = undefined; remoteDesktopRecordingReady.value = false; recordingPlayerExpanded.value = false; recordingAbortController?.abort(); recordingAbortController = new AbortController(); selectedId.value = id; cachedEvents.value = []; recordingIntegrity.value = undefined; remoteDesktopPlaybackDurationMs.value = 0; nextEventCursor = 0; cacheStartCursor = 0; timelineOffset.value = 0; recordedTerminalSize = undefined; await nextTick(); await centerRecordingDialog(); if (isRemoteDesktopRecording.value) { await loadEvents(); if (!hasInvalidRecordingIntegrity()) await ensureRemoteDesktopRecording(); return; } await ensureTerminal(); clearTerminalViewportStyles(); fitAddon?.fit(); terminal?.reset(); void loadEvents(); };
const closePlayer = () => { stop(); remoteDesktopRecording?.abort(); remoteDesktopRecording=undefined; remoteDesktopResizeObserver?.disconnect(); remoteDesktopResizeObserver=undefined; remoteDesktopRecordingReady.value=false; recordingPlayerExpanded.value=false; remoteDesktopRecordingHost.value?.replaceChildren(); recordingAbortController?.abort(); recordingAbortController=undefined; selectedId.value=''; cachedEvents.value=[]; recordingIntegrity.value=undefined; remoteDesktopPlaybackDurationMs.value=0; nextEventCursor=0; cacheStartCursor=0; recordedTerminalSize=undefined; resizeObserver?.disconnect(); resizeObserver=undefined; terminal?.dispose(); terminal=undefined; fitAddon=undefined; };
const deleteRecording = async (recording: SessionRecording) => { if(recording.status==='active'||!await showConfirmDialog({message:t('sessionRecording.confirmDelete',{name:recording.connection_name})}))return; deletingId.value=recording.id; try{await sessionRecordingApi.delete(recording.id);if(selectedId.value===recording.id)closePlayer();await loadList();}catch{error.value=t('sessionRecording.deleteFailed');}finally{deletingId.value='';} };
const seekTo = async (offset: number) => { stop(); if (isRemoteDesktopRecording.value) { remoteDesktopRecording?.seek(offset); timelineOffset.value = offset; return; } if (cacheStartCursor > 0 && offset < (cachedEvents.value[0]?.offsetMs ?? 0)) { preparing.value = true; try { await loadNextEventPage(true); while (nextEventCursor !== null && (cachedEvents.value[cachedEvents.value.length - 1]?.offsetMs ?? 0) < offset) await loadNextEventPage(); } finally { preparing.value = false; } } terminal?.reset(); primeTerminalForReplay(); for (const event of cachedEvents.value) { if (event.offsetMs > offset) break; renderEvent(event); } timelineOffset.value = offset; syncTerminalViewport(); };
const play = async () => {
  if (hasInvalidRecordingIntegrity()) return;
  if (isRemoteDesktopRecording.value) {
    await ensureRemoteDesktopRecording();
    remoteDesktopRecording?.play();
    startRemoteDesktopSpeedController();
    return;
  }
  await ensureTerminal(); await loadEvents(); if (hasInvalidRecordingIntegrity() || !cachedEvents.value.length) return;
  const lastOffset = cachedEvents.value[cachedEvents.value.length - 1]?.offsetMs ?? 0;
  if (timelineOffset.value >= lastOffset && nextEventCursor === null) await seekTo(0);
  else if (timelineOffset.value === 0) { terminal?.reset(); primeTerminalForReplay(); }
  const generation = ++playGeneration; playing.value = true; let previous = timelineOffset.value;
  try { let index = cachedEvents.value.findIndex(event => event.offsetMs >= timelineOffset.value); if (index < 0) index = cachedEvents.value.length; while (generation === playGeneration) { if (index >= cachedEvents.value.length) { if (nextEventCursor === null || !await loadNextEventPage()) break; index = Math.max(0, cachedEvents.value.findIndex(event => event.offsetMs >= previous)); continue; } const event = cachedEvents.value[index++]; const delay = Math.min(1000, Math.max(0, event.offsetMs - previous)) / speed.value; if (delay) await sleep(delay); if (generation !== playGeneration) return; renderEvent(event); timelineOffset.value = event.offsetMs; previous = event.offsetMs; } }
  finally { if (generation === playGeneration) playing.value = false; }
};
const stop = () => { playGeneration += 1; stopRemoteDesktopSpeedController(); remoteDesktopRecording?.pause(); playing.value = false; };
const handleEscape = (event: KeyboardEvent) => { if(event.key==='Escape'&&selectedId.value)closePlayer(); };
onMounted(() => {
  window.addEventListener('keydown', handleEscape);
  const routeQuery = Array.isArray(route.query.recordingQuery) ? route.query.recordingQuery[0] : route.query.recordingQuery;
  const routeStart = Array.isArray(route.query.recordingStartedAfter) ? route.query.recordingStartedAfter[0] : route.query.recordingStartedAfter;
  filterQuery.value = routeQuery || '';
  if (routeStart) {
    const date = new Date(routeStart);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    filterStartedAfter.value = local.toISOString().slice(0, 10);
  }
  void loadList();
});
onBeforeUnmount(() => { window.removeEventListener('keydown', handleEscape); stop(); remoteDesktopRecording?.abort(); remoteDesktopResizeObserver?.disconnect(); recordingAbortController?.abort(); resizeObserver?.disconnect(); terminal?.dispose(); });
</script>

<style scoped>
.recording-workspace .recording-filters{display:grid;grid-template-columns:minmax(13rem,1.4fr) minmax(10rem,1fr) minmax(25rem,2fr) auto auto;align-items:end}.recording-filters>:first-child{grid-column:1}.recording-filters>:nth-child(2){grid-column:2}.recording-filters>:nth-child(3){grid-column:3}.recording-filters>:nth-child(4){grid-column:4}.recording-filters>:nth-child(5){grid-column:5}@media(max-width:1100px){.recording-workspace .recording-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.recording-filters>*{grid-column:auto!important}}
.recording-workspace .recording-layout{display:block;min-height:28rem}.recording-workspace .recording-list{border-right:0}.recording-item{position:relative;border-bottom:1px solid var(--border)}.recording-item .recording-open{display:grid;width:100%;gap:.35rem;padding:.8rem 3.2rem .8rem .8rem;border:0;border-radius:0;background:transparent;color:var(--foreground);text-align:left}.recording-open>span{display:flex;justify-content:space-between}.delete-recording{position:absolute;right:.65rem;top:50%;transform:translateY(-50%);padding:.45rem}.recording-modal{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:1.5rem;background:rgba(0,0,0,.68)}.recording-modal .recording-player{width:min(78rem,100%);height:min(48rem,calc(100dvh - 3rem));overflow:hidden;padding:1rem;border:1px solid var(--border);border-radius:.8rem;background:var(--card);box-shadow:0 24px 70px rgba(0,0,0,.45)}.recording-modal .recording-detail{position:relative;align-items:start;padding-right:2.5rem}.modal-close{position:absolute;right:0;top:0;padding:.4rem .55rem}.recording-modal .terminal-host{flex:1;height:auto;min-height:18rem}.recording-modal .timeline{flex:none}
.recording-workspace button{background:var(--background);color:var(--foreground)}.recording-workspace .recording-filters button[type="submit"],.recording-workspace .player-toolbar button{background:var(--primary);color:var(--primary-foreground)}
.recording-workspace{display:grid;gap:1rem}.recording-filters{display:flex;align-items:end;gap:.65rem;flex-wrap:wrap;padding:1rem;border:1px solid var(--border);border-radius:.75rem;background:var(--card)}.recording-filters label{display:grid;gap:.3rem;flex:1;min-width:11rem}.recording-filters label span{font-size:.75rem;color:var(--muted-foreground)}input,select,button{border:1px solid var(--border);border-radius:.45rem;padding:.55rem .7rem;background:var(--background);color:var(--foreground)}button{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;background:var(--primary);color:var(--primary-foreground);cursor:pointer}.secondary{background:var(--background);color:var(--foreground)}button:disabled{opacity:.5}.recording-message{padding:.7rem;border:1px solid var(--destructive);border-radius:.5rem;color:var(--destructive)}.recording-layout{display:grid;grid-template-columns:minmax(18rem,.72fr) minmax(28rem,1.28fr);min-height:35rem;border:1px solid var(--border);border-radius:.75rem;overflow:hidden}.recording-list{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--border);background:var(--background)}.recording-list>header,.recording-list>footer{display:flex;justify-content:space-between;align-items:center;padding:.8rem;border-bottom:1px solid var(--border)}.recording-list>header span,.recording-list small{color:var(--muted-foreground);font-size:.75rem}.recording-list>button{display:grid;gap:.35rem;padding:.8rem;border:0;border-bottom:1px solid var(--border);border-radius:0;background:transparent;color:var(--foreground);text-align:left}.recording-list>button:hover,.recording-list>button.active{background:var(--accent)}.recording-list>button.active{box-shadow:inset 3px 0 var(--primary)}.recording-list>button>span{display:flex;justify-content:space-between}.recording-list em{font-style:normal;color:var(--primary);font-size:.75rem}.status-dot{display:inline-block;width:.45rem;height:.45rem;margin-right:.35rem;border-radius:50%;background:var(--muted-foreground)}.status-dot.completed{background:var(--success)}.status-dot.active{background:var(--primary)}.status-dot.incomplete,.status-dot.failed{background:var(--warning)}.recording-list>footer{margin-top:auto;border-top:1px solid var(--border);border-bottom:0}.recording-list>footer button{padding:.4rem .6rem}.empty-state,.player-placeholder{display:grid;place-content:center;gap:.6rem;min-height:15rem;text-align:center;color:var(--muted-foreground)}.recording-player{display:flex;flex-direction:column;min-width:0;padding:1rem;gap:.8rem}.recording-detail{display:flex;justify-content:space-between;gap:1rem}.recording-detail h3,.recording-detail p{margin:0}.recording-detail p{color:var(--muted-foreground)}.recording-detail dl{display:flex;gap:1.2rem;margin:0}.recording-detail dl div{display:grid}.recording-detail dt{font-size:.7rem;color:var(--muted-foreground)}.recording-detail dd{margin:0}.player-toolbar{display:flex;align-items:center;gap:.7rem}.player-toolbar label{display:flex;align-items:center;gap:.4rem}.terminal-host{height:27rem;min-width:0;padding:.25rem;border:1px solid var(--border);border-radius:.5rem;background:#000}.timeline{display:flex;align-items:center;gap:.8rem}.timeline input{flex:1;padding:0}.timeline span{font-variant-numeric:tabular-nums;font-size:.8rem}@media(max-width:900px){.recording-layout{grid-template-columns:1fr}.recording-list{max-height:25rem;border-right:0;border-bottom:1px solid var(--border)}.recording-detail{flex-direction:column}}@media(max-width:600px){.recording-detail dl{display:grid;grid-template-columns:repeat(3,1fr)}.terminal-host{height:22rem}}
.recording-workspace .recording-list{align-items:stretch}.recording-item{display:grid;grid-template-columns:minmax(0,1fr) 2.6rem;width:100%}.recording-item .recording-open{display:grid;grid-template-columns:minmax(12rem,1.35fr) minmax(13rem,1fr) minmax(11rem,.85fr);align-items:center;gap:1rem;min-width:0;padding:.75rem .85rem}.recording-open>.recording-primary{display:flex;align-items:center;gap:.55rem;min-width:0}.recording-primary strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.recording-primary em{flex:none;padding:.1rem .38rem;border:1px solid var(--border);border-radius:999px}.recording-open>.recording-owner,.recording-open>.recording-state{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;column-gap:.45rem;min-width:0}.recording-owner>i,.recording-state>.status-dot{grid-row:1/3}.recording-owner small,.recording-state small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.recording-owner>i{color:var(--muted-foreground);font-size:.75rem}.delete-recording{position:static;align-self:center;justify-self:center;width:2rem;height:2rem;padding:0;transform:none}.recording-modal .recording-player{display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;gap:.7rem;box-sizing:border-box;width:min(78rem,calc(100dvw - 3rem));height:min(48rem,calc(100dvh - 3rem));max-height:calc(100dvh - 3rem);min-height:0}.recording-drag-handle{cursor:move;user-select:none}.recording-modal .terminal-host{position:relative;min-height:0;height:auto;overflow:hidden;padding:.25rem}.recording-modal .terminal-host :deep(.xterm){width:100%;height:100%}.recording-modal .timeline{min-width:0}.recording-modal .timeline input{min-width:0}.recording-detail dl{flex-wrap:wrap}.player-toolbar{min-width:0}.player-toolbar>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@media(max-width:860px){.recording-item .recording-open{grid-template-columns:minmax(10rem,1.2fr) minmax(10rem,1fr) minmax(9rem,.8fr);gap:.65rem}.recording-modal{padding:.75rem}.recording-modal .recording-player{height:calc(100dvh - 1.5rem);max-height:calc(100dvh - 1.5rem)}}@media(max-width:640px){.recording-item{grid-template-columns:minmax(0,1fr) 2.5rem}.recording-item .recording-open{grid-template-columns:1fr;gap:.38rem;padding:.7rem}.recording-open>.recording-owner,.recording-open>.recording-state{display:flex;gap:.4rem}.recording-owner>i,.recording-state>.status-dot{grid-row:auto}.recording-owner small:last-child,.recording-state small:last-child{margin-left:auto}.recording-modal{place-items:stretch;padding:.35rem}.recording-modal .recording-player{width:calc(100dvw - .7rem);height:calc(100dvh - .7rem);max-height:calc(100dvh - .7rem);padding:.6rem;border-radius:.55rem}.recording-modal .recording-detail{display:grid;grid-template-columns:minmax(0,1fr) auto;padding-right:0}.recording-modal .recording-detail>div{min-width:0}.recording-modal .recording-detail h3,.recording-modal .recording-detail p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.recording-modal .recording-detail dl{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.45rem}.recording-modal .modal-close{position:static;grid-column:2;grid-row:1}.recording-modal .player-toolbar{justify-content:space-between;gap:.45rem}.recording-modal .player-toolbar button{padding:.48rem .6rem}.recording-modal .player-toolbar>span{display:none}.recording-modal .timeline{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.5rem}.recording-modal .terminal-host{min-height:0}.recording-drag-handle{cursor:default}}
.remote-desktop-recording-host{display:grid;place-items:center}
/* Guacamole 将默认图层画布设为 z-index:-1；在录像宿主内建立局部层叠上下文，避免被黑色背景遮住。 */
.remote-desktop-recording-host :deep(div[style*="position: absolute"]:first-child) {
  z-index: 0;
}
.recording-modal .recording-detail{padding-right:0}.modal-actions{display:flex;gap:.35rem;align-items:center}.modal-actions .modal-close{position:static;padding:.4rem .55rem}.recording-modal .recording-player.recording-player--expanded{position:absolute!important;inset:.75rem!important;width:auto!important;height:auto!important;max-height:none!important;border-radius:.55rem}.recording-player--expanded .recording-drag-handle{cursor:default}@media(max-width:640px){.recording-modal .recording-player.recording-player--expanded{inset:.35rem!important}}
</style>

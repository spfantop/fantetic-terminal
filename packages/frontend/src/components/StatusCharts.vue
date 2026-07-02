<template>
  <div class="status-charts">
    <article class="chart-card">
      <div class="chart-card__header">
        <span>{{ t('statusMonitor.cpuUsageTitle') }}</span>
        <strong>{{ latestCpuDisplay }}</strong>
      </div>
      <div class="sparkline" aria-hidden="true">
        <svg viewBox="0 0 240 72" preserveAspectRatio="none">
          <polyline class="sparkline-grid" points="0,36 240,36" />
          <polyline class="sparkline-line sparkline-line--cpu" :points="cpuPoints" />
        </svg>
      </div>
    </article>

    <article class="chart-card">
      <div class="chart-card__header">
        <span>{{ t('statusMonitor.memoryUsageTitleUnit', { unit: memoryUnit }) }}</span>
        <strong>{{ latestMemoryDisplay }}</strong>
      </div>
      <div class="sparkline" aria-hidden="true">
        <svg viewBox="0 0 240 72" preserveAspectRatio="none">
          <polyline class="sparkline-grid" points="0,36 240,36" />
          <polyline class="sparkline-line sparkline-line--memory" :points="memoryPoints" />
        </svg>
      </div>
    </article>

    <article class="chart-card">
      <div class="chart-card__header">
        <span>{{ t('statusMonitor.networkSpeedTitleUnit', { unit: networkUnit }) }}</span>
        <strong>{{ latestNetworkDisplay }}</strong>
      </div>
      <div class="sparkline sparkline--network" aria-hidden="true">
        <svg viewBox="0 0 240 72" preserveAspectRatio="none">
          <polyline class="sparkline-grid" points="0,36 240,36" />
          <polyline class="sparkline-line sparkline-line--download" :points="downloadPoints" />
          <polyline class="sparkline-line sparkline-line--upload" :points="uploadPoints" />
        </svg>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '../stores/session.store';

interface ServerStatusData {
  cpuPercent?: number;
  memUsed?: number;
  memTotal?: number;
  netRxRate?: number;
  netTxRate?: number;
}

const props = defineProps({
  serverStatus: {
    type: Object as PropType<ServerStatusData | null>,
    required: true,
  },
  activeSessionId: {
    type: String as PropType<string | null>,
    required: true,
  },
});

const MAX_DATA_POINTS = 60;
const CHART_WIDTH = 240;
const CHART_HEIGHT = 72;
const MB_TO_GB_THRESHOLD = 1024;
const KB_TO_MB_THRESHOLD = 1024;

const { t } = useI18n();
const sessionStore = useSessionStore();
const { sessions } = storeToRefs(sessionStore);

const currentSessionStatusManager = computed(() =>
  props.activeSessionId ? sessions.value.get(props.activeSessionId)?.statusMonitorManager : null
);

const normalizeHistory = (history: readonly (number | null)[] | undefined) =>
  history && history.length > 0
    ? [...history]
    : (Array(MAX_DATA_POINTS).fill(null) as (number | null)[]);

const currentCpuHistory = computed(() =>
  normalizeHistory(currentSessionStatusManager.value?.cpuHistory.value)
);

const currentMemUsedHistory = computed(() =>
  normalizeHistory(currentSessionStatusManager.value?.memUsedHistory.value)
);

const currentNetRxHistory = computed(() =>
  normalizeHistory(currentSessionStatusManager.value?.netRxHistory.value)
);

const currentNetTxHistory = computed(() =>
  normalizeHistory(currentSessionStatusManager.value?.netTxHistory.value)
);

const memoryUnitIsGB = computed(() => {
  const currentTotalMB = props.serverStatus?.memTotal ?? 0;
  const historyPeakMB = Math.max(...currentMemUsedHistory.value.filter(isNumber), 0);
  return currentTotalMB >= MB_TO_GB_THRESHOLD || historyPeakMB >= MB_TO_GB_THRESHOLD;
});

const networkRateUnitIsMB = computed(() => {
  const currentRxKB = (props.serverStatus?.netRxRate ?? 0) / 1024;
  const currentTxKB = (props.serverStatus?.netTxRate ?? 0) / 1024;
  const peakRxKB = Math.max(...currentNetRxHistory.value.filter(isNumber).map((bps) => bps / 1024), 0);
  const peakTxKB = Math.max(...currentNetTxHistory.value.filter(isNumber).map((bps) => bps / 1024), 0);
  return (
    currentRxKB >= KB_TO_MB_THRESHOLD ||
    currentTxKB >= KB_TO_MB_THRESHOLD ||
    peakRxKB >= KB_TO_MB_THRESHOLD ||
    peakTxKB >= KB_TO_MB_THRESHOLD
  );
});

const memoryUnit = computed(() => (memoryUnitIsGB.value ? 'GB' : 'MB'));
const networkUnit = computed(() => (networkRateUnitIsMB.value ? 'MB/s' : 'KB/s'));

const isNumber = (value: number | null): value is number =>
  value !== null && value !== undefined && Number.isFinite(value);

const toSparklinePoints = (values: (number | null)[], maxValue: number) => {
  const normalizedMax = maxValue > 0 ? maxValue : 1;
  const step = values.length > 1 ? CHART_WIDTH / (values.length - 1) : CHART_WIDTH;
  return values
    .map((value, index) => {
      const yValue = value ?? 0;
      const x = Math.round(index * step * 100) / 100;
      const y = Math.round((CHART_HEIGHT - (Math.min(yValue, normalizedMax) / normalizedMax) * CHART_HEIGHT) * 100) / 100;
      return `${x},${y}`;
    })
    .join(' ');
};

const cpuPoints = computed(() => toSparklinePoints(currentCpuHistory.value, 100));

const memoryDisplayHistory = computed(() =>
  currentMemUsedHistory.value.map((mb) =>
    mb === null ? null : memoryUnitIsGB.value ? mb / MB_TO_GB_THRESHOLD : mb
  )
);

const memoryPoints = computed(() => {
  const maxByTotal = memoryUnitIsGB.value
    ? (props.serverStatus?.memTotal ?? 0) / MB_TO_GB_THRESHOLD
    : props.serverStatus?.memTotal ?? 0;
  const peak = Math.max(...memoryDisplayHistory.value.filter(isNumber), 0);
  return toSparklinePoints(memoryDisplayHistory.value, Math.max(maxByTotal, peak, 1));
});

const convertNetworkHistory = (history: (number | null)[]) => {
  const divisor = networkRateUnitIsMB.value ? 1024 * 1024 : 1024;
  return history.map((bps) => (bps === null ? null : bps / divisor));
};

const downloadHistory = computed(() => convertNetworkHistory(currentNetRxHistory.value));
const uploadHistory = computed(() => convertNetworkHistory(currentNetTxHistory.value));

const networkMax = computed(() =>
  Math.max(...downloadHistory.value.filter(isNumber), ...uploadHistory.value.filter(isNumber), 1)
);

const downloadPoints = computed(() => toSparklinePoints(downloadHistory.value, networkMax.value));
const uploadPoints = computed(() => toSparklinePoints(uploadHistory.value, networkMax.value));

const latestCpuDisplay = computed(() =>
  t('statusMonitor.latestCpuValue', {
    value: (props.serverStatus?.cpuPercent ?? 0).toFixed(1),
  })
);

const latestMemoryDisplay = computed(() => {
  const used = props.serverStatus?.memUsed ?? 0;
  const value = memoryUnitIsGB.value ? used / MB_TO_GB_THRESHOLD : used;
  return t('statusMonitor.latestMemoryValue', {
    value: value.toFixed(memoryUnitIsGB.value ? 1 : 0),
    unit: memoryUnit.value,
  });
});

const latestNetworkDisplay = computed(() => {
  const divisor = networkRateUnitIsMB.value ? 1024 * 1024 : 1024;
  const precision = networkRateUnitIsMB.value ? 2 : 1;
  return t('statusMonitor.latestNetworkValue', {
    download: ((props.serverStatus?.netRxRate ?? 0) / divisor).toFixed(precision),
    upload: ((props.serverStatus?.netTxRate ?? 0) / divisor).toFixed(precision),
    unit: networkUnit.value,
  });
});
</script>

<style scoped>
.status-charts {
  display: grid;
  gap: 0.75rem;
  margin-top: 0.85rem;
}

.chart-card {
  border: 1px solid color-mix(in srgb, var(--border-color) 68%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--header-bg-color) 28%, transparent);
  padding: 0.75rem;
}

.chart-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.55rem;
}

.chart-card__header span {
  color: var(--text-color-secondary);
  font-size: 0.78rem;
  font-weight: 700;
}

.chart-card__header strong {
  color: var(--text-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
  font-weight: 750;
  white-space: nowrap;
}

.sparkline {
  height: 72px;
}

.sparkline svg {
  display: block;
  width: 100%;
  height: 100%;
}

.sparkline-grid {
  fill: none;
  stroke: color-mix(in srgb, var(--border-color) 70%, transparent);
  stroke-width: 1;
  stroke-dasharray: 4 5;
}

.sparkline-line {
  fill: none;
  stroke-width: 2.25;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.sparkline-line--cpu {
  stroke: var(--link-active-color);
}

.sparkline-line--memory,
.sparkline-line--download {
  stroke: var(--color-success);
}

.sparkline-line--upload {
  stroke: var(--color-warning);
}
</style>

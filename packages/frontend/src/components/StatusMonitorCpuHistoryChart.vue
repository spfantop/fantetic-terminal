<template>
  <div ref="chartHostRef" class="cpu-history-chart" :class="{ 'cpu-history-chart--compact': compact }">
    <div v-if="!compact" class="cpu-history-chart__header">
      <h6 class="cpu-history-chart__title">{{ t('statusMonitor.cpuUsageTitle') }}</h6>
      <span class="cpu-history-chart__latest">{{ t('statusMonitor.latestCpuValue', { value: latestCpuValue }) }}</span>
    </div>

    <div class="cpu-history-chart__canvas">
      <Line :data="cpuChartData" :options="cpuChartOptions" :key="chartKey" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import { Line } from 'vue-chartjs';
import {
  CategoryScale,
  Chart as ChartJS,
  type ChartOptions,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
  type TooltipItem,
} from 'chart.js';

ChartJS.register(Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale);

const DISPLAY_POINTS = 24;

const props = defineProps({
  cpuHistory: {
    type: Array as PropType<readonly (number | null)[]>,
    required: true,
  },
  compact: {
    type: Boolean,
    default: false,
  },
});

const { t } = useI18n();
const chartHostRef = ref<HTMLElement | null>(null);
const chartKey = ref(0);
let chartResizeObserver: ResizeObserver | null = null;
let lastChartHostWidth = 0;
let chartResizeTimer: number | null = null;
const CHART_RESIZE_SETTLE_DELAY = 120;

const recentCpuHistory = computed(() => props.cpuHistory.slice(-DISPLAY_POINTS));
const displayPointCount = computed(() => Math.max(recentCpuHistory.value.length, DISPLAY_POINTS));
const latestCpuValue = computed(() => {
  const latest = recentCpuHistory.value[recentCpuHistory.value.length - 1];
  return typeof latest === 'number' && Number.isFinite(latest) ? latest.toFixed(1) : '0.0';
});

const chartLabels = computed(() =>
  Array.from({ length: displayPointCount.value }, (_, index) => `${index + 1}`)
);

const cpuChartData = computed(() => ({
  labels: chartLabels.value,
  datasets: [
    {
      label: t('statusMonitor.cpuUsageLabel'),
      data: recentCpuHistory.value.map(value => (value === null || value === undefined ? null : Number(value.toFixed(1)))),
      borderColor: 'rgba(125, 211, 252, 1)',
      backgroundColor: 'rgba(59, 130, 246, 0.18)',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.24,
      spanGaps: true,
      fill: false,
    },
  ],
}));

const cpuChartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: {
    mode: 'index',
    intersect: false,
  },
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      enabled: !props.compact,
      mode: 'index',
      intersect: false,
      callbacks: {
        title: () => '',
        label: (context: TooltipItem<'line'>) => {
          const value = context.parsed.y;
          if (value === null) return t('statusMonitor.cpuUsageLabel');
          return `${t('statusMonitor.cpuUsageLabel')}: ${Number(value).toFixed(1)}%`;
        },
      },
    },
  },
  scales: {
    x: {
      display: false,
      grid: {
        display: false,
      },
    },
    y: {
      display: !props.compact,
      beginAtZero: true,
      min: 0,
      max: 100,
      ticks: {
        color: '#8fa0b3',
        callback: value => `${value}%`,
      },
      grid: {
        color: 'rgba(148, 163, 184, 0.12)',
      },
    },
  },
}));

const rerenderChart = () => {
  chartKey.value += 1;
};

const scheduleChartRerender = () => {
  if (chartResizeTimer !== null) {
    window.clearTimeout(chartResizeTimer);
    chartResizeTimer = null;
  }

  chartResizeTimer = window.setTimeout(() => {
    chartResizeTimer = null;
    nextTick(rerenderChart);
  }, CHART_RESIZE_SETTLE_DELAY);
};

onMounted(() => {
  const host = chartHostRef.value;
  if (!host || typeof ResizeObserver === 'undefined') return;

  lastChartHostWidth = Math.round(host.clientWidth);
  chartResizeObserver = new ResizeObserver(entries => {
    const entry = entries[0];
    if (!entry) return;

    const nextWidth = Math.round(entry.contentRect.width);
    if (!nextWidth || Math.abs(nextWidth - lastChartHostWidth) < 2) return;

    lastChartHostWidth = nextWidth;
    scheduleChartRerender();
  });

  chartResizeObserver.observe(host);
});

onBeforeUnmount(() => {
  if (chartResizeTimer !== null) {
    window.clearTimeout(chartResizeTimer);
    chartResizeTimer = null;
  }
  chartResizeObserver?.disconnect();
  chartResizeObserver = null;
});
</script>

<style scoped>
.cpu-history-chart {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--border-color) 58%, transparent);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--header-bg-color) 30%, transparent), transparent),
    color-mix(in srgb, var(--app-bg-color) 88%, var(--header-bg-color));
  padding: 10px;
  overflow: hidden;
}

.cpu-history-chart__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.cpu-history-chart__title {
  margin: 0;
  color: var(--text-color);
  font-size: 0.84rem;
  font-weight: 800;
  line-height: 1.2;
}

.cpu-history-chart__latest {
  display: inline-flex;
  min-height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--link-active-color) 26%, transparent);
  background: color-mix(in srgb, var(--link-active-bg-color) 75%, transparent);
  padding: 0 8px;
  color: var(--text-color);
  font-size: 0.68rem;
  font-weight: 800;
}

.cpu-history-chart__canvas {
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 70px;
  overflow: hidden;
}

.cpu-history-chart__canvas :deep(canvas) {
  width: 100% !important;
  max-width: 100% !important;
}

.cpu-history-chart--compact {
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  gap: 0;
  grid-template-rows: minmax(0, 1fr);
}

.cpu-history-chart--compact .cpu-history-chart__canvas {
  height: 100%;
}
</style>

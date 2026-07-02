<template>
  <div class="status-monitor" :class="{ 'status-monitor--inactive': !activeSessionId }">
    <div v-if="!activeSessionId" class="status-state">
      <i class="fas fa-plug status-state__icon"></i>
      <span class="status-state__title">{{ t('layout.noActiveSession.title') }}</span>
    </div>

    <div v-else-if="currentStatusError" class="status-state status-state--error">
      <i class="fas fa-exclamation-triangle status-state__icon"></i>
      <span class="status-state__title">{{ t('statusMonitor.errorPrefix') }} {{ currentStatusError }}</span>
    </div>

    <div v-else-if="!currentServerStatus" class="status-state">
      <i class="fas fa-spinner fa-spin status-state__icon"></i>
      <span class="status-state__title">{{ t('statusMonitor.loading') }}</span>
    </div>

    <section v-else class="sm-shell">
      <header class="sm-header">
        <div class="sm-header__row">
          <div class="sm-header__left">
            <i class="fas fa-desktop sm-header__icon"></i>
            <span class="sm-header__label">{{ t('statusMonitor.title') }}</span>
          </div>
          <div class="sm-header__right">
            <button
              v-if="statusMonitorShowIpBoolean && sessionIpAddress"
              class="sm-chip sm-chip--interactive"
              type="button"
              :title="sessionIpAddress"
              @click="copyIpToClipboard(sessionIpAddress)"
            >
              {{ sessionIpAddress }}
            </button>
            <span class="sm-live-dot"></span>
          </div>
        </div>

        <div class="sm-header__tags">
          <span class="sm-tag">{{ displayOsName }}</span>
          <span v-if="loadAverageDisplay" class="sm-tag">{{ loadAverageDisplay }}</span>
        </div>

        <div class="sm-header__meta">
          <span class="sm-meta">{{ t('statusMonitor.timezoneLabel') }} {{ timezoneDisplay }}</span>
          <span class="sm-meta">{{ t('statusMonitor.uptimeLabel') }} {{ uptimeDisplay }}</span>
        </div>
      </header>

      <section class="sm-section">
        <div class="sm-section__head">
          <div class="sm-section__title-row">
            <i class="fas fa-microchip sm-section__icon"></i>
            <span class="sm-section__title">CPU</span>
          </div>
          <StatusMonitorCpuHistoryChart :cpu-history="currentCpuHistory" :compact="true" class="sm-mini-chart" />
        </div>

        <div v-if="cpuModelLabel" class="sm-cpu-model">{{ cpuModelLabel }}</div>

        <div class="sm-cpu-cores">
          <div
            v-for="item in visibleCpuCoreItems"
            :key="item.key"
            class="sm-cpu-core"
          >
            <span class="sm-cpu-core__index">{{ item.index }}</span>
            <div class="sm-cpu-core__bar">
              <div
                class="sm-cpu-core__fill"
                :class="getCpuFillClass(item.percent)"
                :style="{ width: `${item.percent}%` }"
              ></div>
            </div>
            <span class="sm-cpu-core__val">{{ item.value }}</span>
          </div>
        </div>

        <button type="button" class="sm-link-btn" @click="isCpuCoreModalVisible = true">
          {{ t('statusMonitor.cpuViewAllCores') }}
        </button>
      </section>

      <section class="sm-section">
        <div class="sm-section__head">
          <div class="sm-section__title-row">
            <i class="fas fa-memory sm-section__icon"></i>
            <span class="sm-section__title">{{ t('statusMonitor.memoryCardTitle') }}</span>
          </div>
          <span class="sm-badge">{{ memoryTotalDisplay }}</span>
        </div>

        <div class="sm-memory-row">
          <div class="sm-memory-ring" :style="memoryRingStyle">
            <div class="sm-memory-ring__center">{{ memoryPercentDisplay }}</div>
          </div>

          <div class="sm-memory-stats">
            <div v-for="item in memoryStatItems" :key="item.key" class="sm-memory-stat">
              <span class="sm-dot" :class="`sm-dot--${item.key}`"></span>
              <span class="sm-memory-stat__label">{{ item.label }}</span>
              <span class="sm-memory-stat__value">{{ item.value }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="sm-section">
        <div class="sm-section__head">
          <div class="sm-section__title-row">
            <i class="fas fa-network-wired sm-section__icon"></i>
            <span class="sm-section__title">{{ t('statusMonitor.networkLabel') }}</span>
          </div>
          <StatusMonitorNetworkHistoryChart
            :download-history="currentNetRxHistory"
            :upload-history="currentNetTxHistory"
            :compact="true"
            class="sm-mini-chart"
          />
        </div>

        <div class="sm-net-interface">
          {{ currentServerStatus?.netInterface || t('statusMonitor.notAvailable') }}
        </div>

        <div class="sm-net-table">
          <div class="sm-net-table__head">
            <span></span>
            <span>{{ t('statusMonitor.networkSpeedTitleUnit', { unit: '' }).replace(/[()]/g, '').trim() }}</span>
            <span>{{ t('statusMonitor.totalTrafficLabel') }}</span>
          </div>
          <div
            v-for="item in networkFlowItems"
            :key="item.key"
            class="sm-net-row"
          >
            <span class="sm-net-row__label" :class="`sm-net-row__label--${item.tone}`">
              <i :class="['fas', item.icon]"></i>
              {{ item.label }}
            </span>
            <span class="sm-net-row__val">{{ item.value }}</span>
            <span class="sm-net-row__total">{{ item.totalValue }}</span>
          </div>
        </div>
      </section>

      <section class="sm-section">
        <div class="sm-section__head">
          <div class="sm-section__title-row">
            <i class="fas fa-list-ul sm-section__icon"></i>
            <span class="sm-section__title">{{ t('statusMonitor.processManager.title') }}</span>
          </div>
          <div class="sm-section__actions">
            <span class="sm-badge">{{ t('statusMonitor.processManager.total') }} {{ processTotalDisplay }}</span>
            <button type="button" class="sm-link-btn sm-link-btn--inline" @click="isProcessModalVisible = true">
              {{ t('statusMonitor.processManager.viewAll') }}
            </button>
          </div>
        </div>

        <div class="sm-proc-summary">
          <span>{{ t('statusMonitor.processManager.running') }} {{ processRunningDisplay }}</span>
          <span>{{ t('statusMonitor.processManager.sleeping') }} {{ processSleepingDisplay }}</span>
        </div>

        <div class="sm-proc-table" v-if="processPreviewItems.length > 0">
          <div class="sm-proc-head">
            <span>CPU</span>
            <span>MEM</span>
            <span>CMD</span>
          </div>
          <div
            v-for="item in processPreviewItems"
            :key="item.pid"
            class="sm-proc-row"
          >
            <span class="sm-proc-row__cpu" :class="{ 'sm-proc-row__cpu--hot': item.cpu > 50 }">{{ item.cpu.toFixed(1) }}%</span>
            <span class="sm-proc-row__mem">{{ item.memPercent !== undefined ? item.memPercent.toFixed(1) + '%' : formatProcessMemory(item.memMb) }}</span>
            <span class="sm-proc-row__cmd">
              <span class="sm-proc-row__cmd-text" :title="item.command">{{ truncateCommand(item.command) }}</span>
              <span class="sm-proc-row__pid">PID {{ item.pid }}</span>
            </span>
          </div>
        </div>
        <div v-else class="sm-empty">
          {{ t('statusMonitor.processManager.empty') }}
        </div>
      </section>

      <section class="sm-section">
        <div class="sm-section__head">
          <div class="sm-section__title-row">
            <i class="fas fa-hard-drive sm-section__icon"></i>
            <span class="sm-section__title">{{ t('statusMonitor.diskCardTitle') }}</span>
          </div>
          <span class="sm-badge">{{ diskUsageDisplay }}</span>
        </div>

        <div class="sm-disk-device">
          <span class="sm-disk-device__mount">{{ diskMountPointDisplay }}</span>
          <span class="sm-disk-device__type">{{ t('statusMonitor.diskTypeLabel') }} {{ diskFsTypeDisplay }}</span>
        </div>

        <div class="sm-disk-io">
          <div class="sm-disk-io__item">
            <div class="sm-disk-io__icon sm-disk-io__icon--read"></div>
            <div class="sm-disk-io__col">
              <span class="sm-disk-io__label">{{ t('statusMonitor.diskReadRateLabel') }}</span>
              <span class="sm-disk-io__val">{{ diskReadRateDisplay }}</span>
            </div>
          </div>
          <div class="sm-disk-io__item">
            <div class="sm-disk-io__icon sm-disk-io__icon--write"></div>
            <div class="sm-disk-io__col">
              <span class="sm-disk-io__label">{{ t('statusMonitor.diskWriteRateLabel') }}</span>
              <span class="sm-disk-io__val">{{ diskWriteRateDisplay }}</span>
            </div>
          </div>
        </div>

        <div class="sm-disk-summary">
          <div class="sm-disk-summary__head">
            <span>{{ t('statusMonitor.diskMountLabel') }}</span>
            <span>{{ t('statusMonitor.diskSizeLabel') }}</span>
            <span>{{ t('statusMonitor.diskAvailableLabel') }}</span>
            <span>{{ t('statusMonitor.diskUsedPercentLabel') }}</span>
          </div>
          <div class="sm-disk-summary__row">
            <span class="sm-disk-summary__mount">{{ diskMountPointDisplay }}</span>
            <span>{{ diskSizeDisplay }}</span>
            <span>{{ diskAvailableDisplay }}</span>
            <span class="sm-disk-summary__pct">{{ diskPercentDisplay }}</span>
          </div>
        </div>
      </section>

      <section v-if="currentRoutePlan?.hops?.length" class="sm-section sm-section--route">
        <div class="sm-section__head">
          <div class="sm-section__title-row">
            <i class="fas fa-route sm-section__icon"></i>
            <span class="sm-section__title">{{ t('statusMonitor.routePlan') }}</span>
          </div>
          <span class="sm-badge">
            {{ currentRoutePlan.totalLatencyMs }}ms · {{ t('statusMonitor.hops', { count: currentRoutePlan.hops.length }) }}
          </span>
        </div>
        <div class="route-plan__body">
          <template v-for="(hop, index) in currentRoutePlan.hops" :key="`${hop.host}-${index}`">
            <span class="hop-node" :title="`${hop.username}@${hop.host}:${hop.port}`">
              {{ hop.name || hop.host }}
              <em>{{ hop.latencyMs ?? 0 }}ms</em>
            </span>
            <i v-if="index < currentRoutePlan.hops.length - 1" class="fas fa-arrow-right"></i>
          </template>
        </div>
      </section>
    </section>

    <StatusMonitorCpuCoreModal
      :is-visible="isCpuCoreModalVisible"
      :cpu-core-items="cpuCoreItems"
      :total-cpu-percent="displayCpuPercent"
      @close="isCpuCoreModalVisible = false"
    />
    <StatusMonitorProcessModal
      :is-visible="isProcessModalVisible"
      :session-id="activeSessionId"
      @close="isProcessModalVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, type CSSProperties, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import StatusMonitorCpuCoreModal from './StatusMonitorCpuCoreModal.vue';
import StatusMonitorCpuHistoryChart from './StatusMonitorCpuHistoryChart.vue';
import StatusMonitorNetworkHistoryChart from './StatusMonitorNetworkHistoryChart.vue';
import StatusMonitorProcessModal from './StatusMonitorProcessModal.vue';
import { useSessionStore } from '../stores/session.store';
import { useSettingsStore } from '../stores/settings.store';
import { useConnectionsStore } from '../stores/connections.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import type { ProcessListItem, ServerStatus } from '../types/server.types';

const { t } = useI18n();
const sessionStore = useSessionStore();
const settingsStore = useSettingsStore();
const connectionsStore = useConnectionsStore();
const uiNotificationsStore = useUiNotificationsStore();
const { sessions } = storeToRefs(sessionStore);
const { statusMonitorShowIpBoolean } = storeToRefs(settingsStore);
const isCpuCoreModalVisible = ref(false);
const isProcessModalVisible = ref(false);

const props = defineProps({
  activeSessionId: {
    type: String as PropType<string | null>,
    required: false,
    default: null,
  },
});

const currentSessionState = computed(() =>
  props.activeSessionId ? sessions.value.get(props.activeSessionId) : null
);

const currentServerStatus = computed<ServerStatus | null>(
  () => currentSessionState.value?.statusMonitorManager?.serverStatus?.value ?? null
);

const currentCpuHistory = computed<readonly (number | null)[]>(
  () => currentSessionState.value?.statusMonitorManager?.cpuHistory?.value ?? Array(24).fill(null)
);

const currentNetRxHistory = computed<readonly (number | null)[]>(
  () => currentSessionState.value?.statusMonitorManager?.netRxHistory?.value ?? Array(24).fill(null)
);

const currentNetTxHistory = computed<readonly (number | null)[]>(
  () => currentSessionState.value?.statusMonitorManager?.netTxHistory?.value ?? Array(24).fill(null)
);

const currentRoutePlan = computed(
  () => currentSessionState.value?.statusMonitorManager?.routePlan?.value ?? null
);

const currentStatusError = computed<string | null>(
  () => currentSessionState.value?.statusMonitorManager?.statusError?.value ?? null
);

const cachedCpuModel = ref<string | null>(null);
const cachedCpuCores = ref<number | null>(null);
const cachedOsName = ref<string | null>(null);

watch(
  currentServerStatus,
  (newData) => {
    if (!newData) return;
    if (newData.cpuModel) cachedCpuModel.value = newData.cpuModel;
    if (typeof newData.cpuCores === 'number' && Number.isFinite(newData.cpuCores)) cachedCpuCores.value = newData.cpuCores;
    if (newData.osName) cachedOsName.value = newData.osName;
  },
  { immediate: true }
);

const clampPercent = (value: number | null | undefined) =>
  Math.max(0, Math.min(100, Number.isFinite(value ?? NaN) ? Number(value) : 0));

const displayCpuPercent = computed(() => clampPercent(currentServerStatus.value?.cpuPercent));
const displayMemoryPercent = computed(() => clampPercent(currentServerStatus.value?.memPercent));
const displayDiskPercent = computed(() => clampPercent(currentServerStatus.value?.diskPercent));
const timezoneDisplay = computed(() => currentServerStatus.value?.timezone || t('statusMonitor.notAvailable'));
const processTotalDisplay = computed(() => currentServerStatus.value?.processTotal ?? 0);
const processRunningDisplay = computed(() => currentServerStatus.value?.processRunning ?? 0);
const processSleepingDisplay = computed(() => currentServerStatus.value?.processSleeping ?? 0);
const displayOsName = computed(() => (currentServerStatus.value?.osName ?? cachedOsName.value) || t('statusMonitor.notAvailable'));
const cpuModelLabel = computed(() => cachedCpuModel.value || null);

const loadAverageDisplay = computed(() => {
  const loadAvg = currentServerStatus.value?.loadAvg;
  if (!loadAvg?.length) return null;
  return t('statusMonitor.loadAverageLabel', '负载') + ' ' + loadAvg.map(value => value.toFixed(2)).join(' / ');
});

const formatBytesPerSecond = (bytes?: number): string => {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return t('statusMonitor.notAvailable');
  if (bytes < 1024) return `${bytes} ${t('statusMonitor.bytesPerSecond')}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${t('statusMonitor.kiloBytesPerSecond')}`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} ${t('statusMonitor.megaBytesPerSecond')}`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ${t('statusMonitor.gigaBytesPerSecond')}`;
};

const formatBytes = (bytes?: number): string => {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return t('statusMonitor.notAvailable');
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} ${t('statusMonitor.megaBytes')}`;
  if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ${t('statusMonitor.gigaBytes')}`;
  return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
};

const formatCompactBytes = (bytes?: number): string => {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return t('statusMonitor.notAvailable');
  if (bytes < 1024) return `${bytes.toFixed(1)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const formatStorageSizeFromKb = (kb?: number, compact = false): string => {
  if (kb === undefined || kb === null || Number.isNaN(kb)) return t('statusMonitor.notAvailable');
  const units = compact ? ['KB', 'M', 'G', 'T'] : ['KB', t('statusMonitor.megaBytes'), t('statusMonitor.gigaBytes'), 'TB'];
  let value = kb;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
};

const formatMemorySize = (mb?: number): string => {
  if (mb === undefined || mb === null || Number.isNaN(mb)) return t('statusMonitor.notAvailable');
  if (mb < 1024) return `${mb.toFixed(1)} ${t('statusMonitor.megaBytes')}`;
  return `${(mb / 1024).toFixed(1)} ${t('statusMonitor.gigaBytes')}`;
};

const formatUptime = (seconds?: number): string => {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds < 0) return t('statusMonitor.notAvailable');
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}${t('statusMonitor.uptimeDaySuffix')} ${hours}${t('statusMonitor.uptimeHourSuffix')}`;
  if (hours > 0) return `${hours}${t('statusMonitor.uptimeHourSuffix')} ${minutes}${t('statusMonitor.uptimeMinuteSuffix')}`;
  return `${minutes}${t('statusMonitor.uptimeMinuteSuffix')}`;
};

const formatProcessMemory = (mb?: number): string => {
  if (mb === undefined || mb === null || !Number.isFinite(mb)) return t('statusMonitor.notAvailable');
  if (mb < 1024) return `${mb.toFixed(1)} M`;
  return `${(mb / 1024).toFixed(1)} G`;
};

const truncateCommand = (cmd: string): string => {
  if (!cmd) return '';
  const parts = cmd.split('/');
  const basename = parts[parts.length - 1] || cmd;
  return basename.length > 24 ? `${basename.slice(0, 22)}...` : basename;
};

const getCpuFillClass = (percent: number): string => {
  if (percent >= 90) return 'sm-cpu-core__fill--critical';
  if (percent >= 60) return 'sm-cpu-core__fill--warn';
  return 'sm-cpu-core__fill--normal';
};

const memoryTotalValue = computed(() => currentServerStatus.value?.memTotal ?? 0);
const memoryUsedValue = computed(() => currentServerStatus.value?.memUsed ?? 0);
const memoryCachedValue = computed(() => currentServerStatus.value?.memCached ?? 0);
const memoryFreeValue = computed(() => {
  const data = currentServerStatus.value;
  if (data?.memFree !== undefined) return data.memFree;
  if (data?.memTotal !== undefined && data?.memUsed !== undefined) return Math.max(data.memTotal - data.memUsed - (data.memCached ?? 0), 0);
  return 0;
});

const memoryTotalDisplay = computed(() => formatMemorySize(currentServerStatus.value?.memTotal));
const memoryPercentDisplay = computed(() => `${Math.round(displayMemoryPercent.value)}%`);
const memoryRingStyle = computed<CSSProperties>(() => {
  const total = memoryTotalValue.value;
  if (total <= 0) return { background: 'conic-gradient(var(--border-color) 0% 100%)' };
  const usedPercent = Math.min(100, (memoryUsedValue.value / total) * 100);
  const cachedPercent = Math.min(100 - usedPercent, (memoryCachedValue.value / total) * 100);
  const usedEnd = usedPercent;
  const cacheEnd = usedPercent + cachedPercent;
  return { background: `conic-gradient(var(--color-error) 0 ${usedEnd}%, var(--text-color-secondary) ${usedEnd}% ${cacheEnd}%, var(--color-success) ${cacheEnd}% 100%)` };
});

const memoryStatItems = computed(() => [
  { key: 'used', label: t('statusMonitor.memoryUsedStat'), value: formatMemorySize(memoryUsedValue.value) },
  { key: 'cached', label: t('statusMonitor.memoryCachedStat'), value: formatMemorySize(memoryCachedValue.value) },
  { key: 'free', label: t('statusMonitor.memoryFreeStat'), value: formatMemorySize(memoryFreeValue.value) },
]);

const diskUsageDisplay = computed(() => {
  const data = currentServerStatus.value;
  if (!data || data.diskUsed === undefined || data.diskTotal === undefined) return t('statusMonitor.notAvailable');
  return `${formatStorageSizeFromKb(data.diskUsed, true)} / ${formatStorageSizeFromKb(data.diskTotal, true)}`;
});

const diskFsTypeDisplay = computed(() => currentServerStatus.value?.diskFsType || t('statusMonitor.notAvailable'));
const diskReadRateDisplay = computed(() => formatCompactBytes(currentServerStatus.value?.diskReadRate));
const diskWriteRateDisplay = computed(() => formatCompactBytes(currentServerStatus.value?.diskWriteRate));
const diskMountPointDisplay = computed(() => currentServerStatus.value?.diskMountPoint || t('statusMonitor.notAvailable'));
const diskSizeDisplay = computed(() => formatStorageSizeFromKb(currentServerStatus.value?.diskTotal, true));
const diskAvailableDisplay = computed(() => formatStorageSizeFromKb(currentServerStatus.value?.diskAvailable, true));
const diskPercentDisplay = computed(() => `${Math.round(displayDiskPercent.value)}%`);

const sessionIpAddress = computed(() => {
  const sessionState = currentSessionState.value;
  if (!sessionState?.connectionId) return null;

  const connectionIdAsNumber = parseInt(sessionState.connectionId, 10);
  if (Number.isNaN(connectionIdAsNumber)) return null;

  return connectionsStore.connections.find((conn) => conn.id === connectionIdAsNumber)?.host || null;
});

const uptimeDisplay = computed(() => formatUptime(currentServerStatus.value?.uptimeSeconds));
const topProcessPreview = computed<readonly ProcessListItem[]>(() => currentServerStatus.value?.topProcesses ?? []);
const processPreviewItems = computed<readonly ProcessListItem[]>(() => topProcessPreview.value.slice(0, 4));

const cpuCoreItems = computed(() => {
  const rawPercents = currentServerStatus.value?.cpuCorePercents;
  const fallbackCoreCount = (() => {
    const currentCores = currentServerStatus.value?.cpuCores ?? cachedCpuCores.value;
    if (typeof currentCores !== 'number' || !Number.isFinite(currentCores) || currentCores <= 0) return 0;
    return Math.round(currentCores);
  })();
  const normalizedPercents = Array.isArray(rawPercents) && rawPercents.length > 0
    ? rawPercents
    : Array.from({ length: fallbackCoreCount }, () => 0);

  return normalizedPercents.map((percent, idx) => {
    const clampedPercent = clampPercent(percent);
    return {
      key: `cpu-core-${idx}`,
      index: idx,
      label: t('statusMonitor.cpuCoreLabel', { index: idx + 1 }),
      value: `${Math.round(clampedPercent)}%`,
      percent: clampedPercent,
    };
  });
});

const visibleCpuCoreItems = computed(() => cpuCoreItems.value.slice(0, 8));

const networkFlowItems = computed(() => [
  {
    key: 'upload',
    label: t('statusMonitor.uploadLabel'),
    value: formatBytesPerSecond(currentServerStatus.value?.netTxRate),
    totalValue: formatBytes(currentServerStatus.value?.netTxTotalBytes),
    tone: 'up',
    icon: 'fa-arrow-up',
  },
  {
    key: 'download',
    label: t('statusMonitor.downloadLabel'),
    value: formatBytesPerSecond(currentServerStatus.value?.netRxRate),
    totalValue: formatBytes(currentServerStatus.value?.netRxTotalBytes),
    tone: 'down',
    icon: 'fa-arrow-down',
  },
]);

const copyIpToClipboard = async (ipAddress: string | null) => {
  if (!ipAddress) return;
  try {
    await navigator.clipboard.writeText(ipAddress);
    uiNotificationsStore.showSuccess(t('common.copied', '已复制!'));
  } catch (error) {
    console.error('Failed to copy IP address: ', error);
    uiNotificationsStore.showError(t('statusMonitor.copyIpError', '复制 IP 失败'));
  }
};
</script>

<style scoped>
.status-monitor {
  height: 100%;
  overflow-y: auto;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--app-bg-color) 92%, var(--header-bg-color)), var(--app-bg-color));
  color: var(--text-color);
  padding: 10px;
  font-size: 0.875rem;
}

.status-monitor--inactive {
  background: var(--header-bg-color);
}

.sm-shell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.status-state {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-color-secondary);
  text-align: center;
}

.status-state--error {
  color: var(--color-error);
}

.status-state__icon {
  color: currentColor;
  font-size: 28px;
}

.status-state__title {
  font-size: 0.9rem;
  font-weight: 700;
}

.sm-header,
.sm-section {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 58%, transparent);
  padding: 10px 12px;
}

.sm-section:last-child {
  border-bottom: none;
}

.sm-header__row,
.sm-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sm-header__left,
.sm-header__right,
.sm-section__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.sm-section__actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.sm-header__icon,
.sm-section__icon {
  color: var(--text-color-secondary);
  font-size: 0.76rem;
}

.sm-header__label {
  color: var(--text-color-secondary);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.sm-section__title {
  color: var(--text-color);
  font-size: 0.84rem;
  font-weight: 800;
}

.sm-chip,
.sm-badge,
.sm-tag {
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, var(--border-color) 62%, transparent);
  background: color-mix(in srgb, var(--header-bg-color) 52%, transparent);
  color: var(--text-color-secondary);
  font-size: 0.7rem;
  font-weight: 700;
}

.sm-chip {
  border: none;
  padding: 2px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.sm-chip--interactive {
  cursor: pointer;
}

.sm-chip--interactive:hover {
  color: var(--text-color);
}

.sm-badge {
  padding: 2px 8px;
  white-space: nowrap;
}

.sm-live-dot {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--color-success);
  box-shadow: 0 0 8px color-mix(in srgb, var(--color-success) 70%, transparent);
}

.sm-header__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.sm-tag {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  padding: 3px 8px;
  color: var(--text-color);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-header__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 8px;
  color: var(--text-color-secondary);
  font-size: 0.7rem;
}

.sm-meta {
  white-space: nowrap;
}

.sm-mini-chart {
  flex: 1;
  min-width: 0;
  max-width: 160px;
  height: 28px;
  overflow: hidden;
}

.sm-link-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  border: none;
  background: none;
  color: var(--text-color-secondary);
  cursor: pointer;
  font-size: 0.7rem;
  padding: 0;
}

.sm-link-btn--inline {
  margin-top: 0;
  white-space: nowrap;
}

.sm-link-btn:hover {
  color: var(--text-color);
}

.sm-cpu-model {
  overflow: hidden;
  color: var(--text-color-secondary);
  font-size: 0.7rem;
  line-height: 1.3;
  padding: 0 2px 4px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-cpu-cores {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sm-cpu-core {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sm-cpu-core__index {
  width: 14px;
  flex-shrink: 0;
  color: var(--text-color-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.65rem;
  text-align: right;
}

.sm-cpu-core__bar {
  flex: 1;
  height: 10px;
  overflow: hidden;
  border-radius: 3px;
  background: color-mix(in srgb, var(--border-color) 42%, transparent);
}

.sm-cpu-core__fill {
  height: 100%;
  min-width: 1px;
  border-radius: inherit;
  transition: width 0.3s ease;
}

.sm-cpu-core__fill--normal {
  background: var(--color-success);
}

.sm-cpu-core__fill--warn {
  background: var(--color-warning);
}

.sm-cpu-core__fill--critical {
  background: var(--color-error);
}

.sm-cpu-core__val {
  width: 38px;
  flex-shrink: 0;
  color: var(--text-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.7rem;
  font-weight: 750;
  text-align: right;
}

.sm-memory-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sm-memory-ring {
  position: relative;
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  border-radius: 50%;
}

.sm-memory-ring::after {
  position: absolute;
  inset: 9px;
  border-radius: 50%;
  background: var(--app-bg-color);
  content: '';
}

.sm-memory-ring__center {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color);
  font-size: 0.7rem;
  font-weight: 800;
}

.sm-memory-stats {
  display: flex;
  flex: 1;
  gap: 12px;
  min-width: 0;
}

.sm-memory-stat {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  white-space: nowrap;
}

.sm-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
}

.sm-dot--used {
  background: var(--color-error);
}

.sm-dot--cached {
  background: var(--text-color-secondary);
}

.sm-dot--free {
  background: var(--color-success);
}

.sm-memory-stat__label {
  color: var(--text-color-secondary);
  font-size: 0.65rem;
}

.sm-memory-stat__value {
  color: var(--text-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.7rem;
  font-weight: 800;
}

.sm-net-interface {
  margin-bottom: 5px;
  color: var(--text-color-secondary);
  font-size: 0.68rem;
  font-weight: 700;
}

.sm-net-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sm-net-table__head,
.sm-net-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
}

.sm-net-table__head {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
  color: var(--text-color-secondary);
  font-size: 0.64rem;
  padding: 0 0 4px;
}

.sm-net-table__head span:not(:first-child),
.sm-net-row__val,
.sm-net-row__total {
  text-align: right;
}

.sm-net-row {
  align-items: center;
  padding: 4px 0;
}

.sm-net-row__label {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-color);
  font-size: 0.7rem;
  font-weight: 700;
}

.sm-net-row__label i {
  width: 10px;
  color: currentColor;
  font-size: 0.65rem;
  text-align: center;
}

.sm-net-row__label--up {
  color: var(--color-success);
}

.sm-net-row__label--down {
  color: #60a5fa;
}

.sm-net-row__val,
.sm-net-row__total {
  color: var(--text-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.7rem;
  font-weight: 700;
}

.sm-net-row__total {
  color: var(--text-color-secondary);
  font-weight: 500;
}

.sm-proc-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--text-color-secondary);
  font-size: 0.68rem;
  font-weight: 700;
}

.sm-proc-table {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.sm-proc-head,
.sm-proc-row {
  display: grid;
  grid-template-columns: 60px 52px minmax(0, 1fr);
  gap: 6px;
}

.sm-proc-head {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
  color: var(--text-color-secondary);
  font-size: 0.64rem;
  font-weight: 700;
  padding: 0 0 4px;
}

.sm-proc-row {
  align-items: center;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 28%, transparent);
  font-size: 0.7rem;
  padding: 5px 0;
}

.sm-proc-row:last-child {
  border-bottom: none;
}

.sm-proc-row__cpu {
  color: var(--text-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 800;
}

.sm-proc-row__cpu--hot {
  color: var(--color-error);
}

.sm-proc-row__mem {
  color: var(--text-color-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.sm-proc-row__cmd {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.sm-proc-row__cmd-text {
  overflow: hidden;
  color: var(--text-color);
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-proc-row__pid {
  color: var(--text-color-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.64rem;
}

.sm-empty {
  color: var(--text-color-secondary);
  font-size: 0.76rem;
  padding: 10px;
  text-align: center;
}

.sm-disk-device {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.sm-disk-device__mount {
  color: var(--text-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9rem;
  font-weight: 800;
}

.sm-disk-device__type {
  border-radius: 4px;
  background: color-mix(in srgb, var(--header-bg-color) 52%, transparent);
  color: var(--text-color-secondary);
  font-size: 0.64rem;
  font-weight: 700;
  padding: 1px 6px;
}

.sm-disk-io {
  display: flex;
  gap: 16px;
  margin-bottom: 10px;
}

.sm-disk-io__item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sm-disk-io__icon {
  width: 16px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 3px;
  background: color-mix(in srgb, var(--border-color) 44%, transparent);
}

.sm-disk-io__icon--read {
  border-left: 3px solid #60a5fa;
}

.sm-disk-io__icon--write {
  border-left: 3px solid var(--color-success);
}

.sm-disk-io__col {
  display: flex;
  flex-direction: column;
}

.sm-disk-io__label {
  color: var(--text-color-secondary);
  font-size: 0.64rem;
}

.sm-disk-io__val {
  color: var(--text-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.82rem;
  font-weight: 800;
}

.sm-disk-summary {
  border-top: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
  padding-top: 8px;
}

.sm-disk-summary__head,
.sm-disk-summary__row {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.sm-disk-summary__head {
  color: var(--text-color-secondary);
  font-size: 0.64rem;
  font-weight: 700;
  padding-bottom: 4px;
}

.sm-disk-summary__row {
  color: var(--text-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.7rem;
  font-weight: 700;
}

.sm-disk-summary__mount {
  color: var(--color-success);
}

.sm-disk-summary__pct {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
  color: var(--color-success);
  font-size: 0.64rem;
  padding: 1px 6px;
}

.route-plan__body {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.route-plan__body > i {
  color: var(--text-color-secondary);
  font-size: 0.65rem;
}

.hop-node {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 100%;
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--header-bg-color) 34%, transparent);
  color: var(--text-color);
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0.25rem 0.55rem;
}

.hop-node em {
  color: var(--text-color-secondary);
  font-style: normal;
  font-weight: 650;
}

@media (max-width: 640px) {
  .status-monitor {
    padding: 8px;
  }

  .sm-memory-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .sm-memory-stats {
    flex-wrap: wrap;
  }

  .sm-disk-io {
    flex-direction: column;
    gap: 8px;
  }
}
</style>

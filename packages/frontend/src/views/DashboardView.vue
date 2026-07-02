<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { formatDistanceToNow } from 'date-fns';
import { zhCN, enUS, ja } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import AddConnectionForm from '../components/AddConnectionForm.vue';
import { useConnectionsStore } from '../stores/connections.store';
import { useAuditLogStore } from '../stores/audit.store';
import { useSessionStore } from '../stores/session.store';
import { useTagsStore } from '../stores/tags.store';
import type { TagInfo } from '../stores/tags.store';
import type { SortField, SortOrder } from '../stores/settings.store';
import type { ConnectionInfo } from '../stores/connections.store';
import type { AuditLogEntry } from '../types/server.types';

type DashboardTone = 'neutral' | 'success' | 'warning' | 'danger';

const { t, locale } = useI18n();
const router = useRouter();
const connectionsStore = useConnectionsStore();
const auditLogStore = useAuditLogStore();
const sessionStore = useSessionStore();
const tagsStore = useTagsStore();

const {
  connections,
  folders,
  isLoading: isLoadingConnections,
  isFoldersLoading,
} = storeToRefs(connectionsStore);
const { logs: auditLogs, isLoading: isLoadingLogs } = storeToRefs(auditLogStore);
const { tags, isLoading: isLoadingTags } = storeToRefs(tagsStore);
const { sessionTabsWithStatus } = storeToRefs(sessionStore);

const LS_SORT_BY_KEY = 'dashboard_connections_sort_by';
const LS_SORT_ORDER_KEY = 'dashboard_connections_sort_order';
const LS_FILTER_TAG_KEY = 'dashboard_connections_filter_tag';
const maxRecentLogs = 8;
const maxDashboardConnections = 8;

const localSortBy = ref<SortField>((localStorage.getItem(LS_SORT_BY_KEY) as SortField) || 'last_connected_at');
const localSortOrder = ref<SortOrder>((localStorage.getItem(LS_SORT_ORDER_KEY) as SortOrder) || 'desc');
const getInitialSelectedTagId = (): number | null => {
  const storedValue = localStorage.getItem(LS_FILTER_TAG_KEY);
  return storedValue && storedValue !== 'null' ? parseInt(storedValue, 10) : null;
};
const selectedTagId = ref<number | null>(getInitialSelectedTagId());
const searchQuery = ref('');
const showAddEditConnectionForm = ref(false);
const connectionToEdit = ref<ConnectionInfo | null>(null);
const isRefreshing = ref(false);

const sortOptions: { value: SortField; labelKey: string }[] = [
  { value: 'last_connected_at', labelKey: 'dashboard.sortOptions.lastConnected' },
  { value: 'name', labelKey: 'dashboard.sortOptions.name' },
  { value: 'type', labelKey: 'dashboard.sortOptions.type' },
  { value: 'updated_at', labelKey: 'dashboard.sortOptions.updated' },
  { value: 'created_at', labelKey: 'dashboard.sortOptions.created' },
];

const dateFnsLocales: Record<string, Locale> = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'ja-JP': ja,
  en: enUS,
  zh: zhCN,
  ja,
};

const percentOf = (count: number, total: number) => (total > 0 ? Math.round((count / total) * 100) : 0);

const isTodayTimestamp = (timestampInSeconds: number | null | undefined) => {
  if (!timestampInSeconds) return false;
  const date = new Date(timestampInSeconds * 1000);
  const now = new Date();
  return date.toDateString() === now.toDateString();
};

const formatRelativeTime = (timestampInSeconds: number | null | undefined): string => {
  if (!timestampInSeconds) return t('connections.status.never');
  try {
    const timestampInMs = timestampInSeconds * 1000;
    if (Number.isNaN(timestampInMs)) return String(timestampInSeconds);
    const currentLocale = locale.value;
    const langPart = currentLocale.split('-')[0];
    const targetLocale = dateFnsLocales[currentLocale] || dateFnsLocales[langPart] || enUS;
    return formatDistanceToNow(new Date(timestampInMs), { addSuffix: true, locale: targetLocale });
  } catch {
    return String(timestampInSeconds);
  }
};

const filteredAndSortedConnections = computed(() => {
  const sortBy = localSortBy.value;
  const sortOrderVal = localSortOrder.value;
  const factor = sortOrderVal === 'desc' ? -1 : 1;
  const filterTagId = selectedTagId.value;
  const query = searchQuery.value.toLowerCase().trim();

  const filteredByTag =
    filterTagId === null
      ? [...connections.value]
      : connections.value.filter(conn => conn.tag_ids?.includes(filterTagId));

  const searchedConnections = query
    ? filteredByTag.filter(conn => {
        const nameMatch = conn.name?.toLowerCase().includes(query);
        const usernameMatch = conn.username?.toLowerCase().includes(query);
        const hostMatch = conn.host?.toLowerCase().includes(query);
        const portMatch = conn.port?.toString().includes(query);
        return nameMatch || usernameMatch || hostMatch || portMatch;
      })
    : filteredByTag;

  return searchedConnections.sort((a, b) => {
    let valA: string | number;
    let valB: string | number;

    switch (sortBy) {
      case 'name':
        return (a.name || '').localeCompare(b.name || '') * factor;
      case 'type':
        return (a.type || '').localeCompare(b.type || '') * factor;
      case 'created_at':
        return ((a.created_at ?? 0) - (b.created_at ?? 0)) * factor;
      case 'updated_at':
        return ((a.updated_at ?? 0) - (b.updated_at ?? 0)) * factor;
      case 'last_connected_at':
        valA = a.last_connected_at ?? (sortOrderVal === 'desc' ? -Infinity : Infinity);
        valB = b.last_connected_at ?? (sortOrderVal === 'desc' ? -Infinity : Infinity);
        if (valA === valB) return 0;
        return valA < valB ? -1 * factor : 1 * factor;
      default:
        return 0;
    }
  });
});

const dashboardConnections = computed(() =>
  filteredAndSortedConnections.value.slice(0, maxDashboardConnections)
);

const recentAuditLogs = computed(() => auditLogs.value.slice(0, maxRecentLogs));
const totalConnections = computed(() => connections.value.length);
const folderCount = computed(() => folders.value.length);
const activeTodayCount = computed(
  () => connections.value.filter(conn => isTodayTimestamp(conn.last_connected_at)).length
);
const taggedConnectionCount = computed(
  () => connections.value.filter(conn => (conn.tag_ids?.length || 0) > 0).length
);
const folderedConnectionCount = computed(
  () => connections.value.filter(conn => conn.folder_id !== null && conn.folder_id !== undefined).length
);
const neverConnectedCount = computed(
  () => connections.value.filter(conn => !conn.last_connected_at).length
);
const connectedSessionCount = computed(
  () => sessionTabsWithStatus.value.filter(tab => tab.status === 'connected').length
);
const activeSessionCount = computed(
  () => sessionTabsWithStatus.value.filter(tab => tab.status === 'connected' || tab.status === 'connecting').length
);
const failedActionCount = computed(
  () => recentAuditLogs.value.filter(log => isFailedAction(log.action_type)).length
);

const statCards = computed(() => [
  {
    key: 'servers',
    label: t('dashboard.stats.totalServers'),
    value: totalConnections.value,
    detail: t('dashboard.statsDetails.folders', { count: folderCount.value }),
    icon: 'fa-server',
    tone: 'neutral' as DashboardTone,
  },
  {
    key: 'sessions',
    label: t('dashboard.stats.activeSessions'),
    value: activeSessionCount.value,
    detail: t('dashboard.statsDetails.connectedSessions', {
      count: connectedSessionCount.value,
      total: sessionTabsWithStatus.value.length,
    }),
    icon: 'fa-terminal',
    tone: activeSessionCount.value > 0 ? ('success' as DashboardTone) : ('neutral' as DashboardTone),
  },
  {
    key: 'today',
    label: t('dashboard.stats.activeToday'),
    value: activeTodayCount.value,
    detail: t('dashboard.statsDetails.recentlyConnected'),
    icon: 'fa-bolt',
    tone: activeTodayCount.value > 0 ? ('success' as DashboardTone) : ('neutral' as DashboardTone),
  },
  {
    key: 'activity',
    label: t('dashboard.stats.recentEvents'),
    value: recentAuditLogs.value.length,
    detail: t('dashboard.statsDetails.failedEvents', { count: failedActionCount.value }),
    icon: failedActionCount.value > 0 ? 'fa-exclamation-triangle' : 'fa-history',
    tone: failedActionCount.value > 0 ? ('warning' as DashboardTone) : ('neutral' as DashboardTone),
  },
]);

const connectionTypeStats = computed(() =>
  (['SSH', 'RDP', 'VNC'] as ConnectionInfo['type'][]).map(type => {
    const count = connections.value.filter(conn => conn.type === type).length;
    return {
      type,
      count,
      percent: percentOf(count, totalConnections.value),
      icon: type === 'SSH' ? 'fa-terminal' : type === 'RDP' ? 'fa-desktop' : 'fa-eye',
    };
  })
);

const organizationItems = computed(() => [
  {
    key: 'tags',
    label: t('dashboard.organization.tagCoverage'),
    value: taggedConnectionCount.value,
    total: totalConnections.value,
    percent: percentOf(taggedConnectionCount.value, totalConnections.value),
    tone: 'success' as DashboardTone,
  },
  {
    key: 'folders',
    label: t('dashboard.organization.folderCoverage'),
    value: folderedConnectionCount.value,
    total: totalConnections.value,
    percent: percentOf(folderedConnectionCount.value, totalConnections.value),
    tone: 'neutral' as DashboardTone,
  },
  {
    key: 'never',
    label: t('dashboard.organization.neverConnected'),
    value: neverConnectedCount.value,
    total: totalConnections.value,
    percent: percentOf(neverConnectedCount.value, totalConnections.value),
    tone: neverConnectedCount.value > 0 ? ('warning' as DashboardTone) : ('success' as DashboardTone),
  },
]);

const topTags = computed(() => {
  const tagRows = tags.value.map(tag => {
    const count = connections.value.filter(conn => conn.tag_ids?.includes(tag.id)).length;
    return { ...tag, count, percent: percentOf(count, totalConnections.value) };
  });
  return tagRows.filter(tag => tag.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
});

const visibleConnectionCountLabel = computed(() =>
  t('dashboard.connectionListCount', {
    count: filteredAndSortedConnections.value.length,
    total: totalConnections.value,
  })
);

const isDashboardLoading = computed(
  () =>
    isRefreshing.value ||
    isLoadingConnections.value ||
    isLoadingLogs.value ||
    isLoadingTags.value ||
    isFoldersLoading.value
);

const loadDashboardData = async () => {
  await Promise.allSettled([
    connectionsStore.fetchConnections(),
    connectionsStore.fetchFolders(),
    tagsStore.fetchTags(),
    auditLogStore.fetchLogs({
      page: 1,
      limit: maxRecentLogs,
      sortOrder: 'desc',
      isDashboardRequest: true,
    }),
  ]);
};

onMounted(async () => {
  await loadDashboardData();
});

watch(localSortBy, newValue => {
  localStorage.setItem(LS_SORT_BY_KEY, newValue);
});

watch(localSortOrder, newValue => {
  localStorage.setItem(LS_SORT_ORDER_KEY, newValue);
});

watch(selectedTagId, newValue => {
  localStorage.setItem(LS_FILTER_TAG_KEY, newValue === null ? 'null' : String(newValue));
});

const refreshDashboard = async () => {
  isRefreshing.value = true;
  try {
    await loadDashboardData();
  } finally {
    isRefreshing.value = false;
  }
};

const connectTo = (connection: ConnectionInfo) => {
  sessionStore.handleConnectRequest(connection);
};

const openAddConnectionForm = () => {
  connectionToEdit.value = null;
  showAddEditConnectionForm.value = true;
};

const handleFormClose = () => {
  showAddEditConnectionForm.value = false;
  connectionToEdit.value = null;
};

const handleConnectionModified = async () => {
  showAddEditConnectionForm.value = false;
  connectionToEdit.value = null;
  await connectionsStore.fetchConnections();
};

const toggleSortOrder = () => {
  localSortOrder.value = localSortOrder.value === 'asc' ? 'desc' : 'asc';
};

const isAscending = computed(() => localSortOrder.value === 'asc');

const navigateTo = (name: string) => {
  router.push({ name });
};

const getConnectionDisplayName = (conn: ConnectionInfo) =>
  conn.name || conn.host || t('connections.unnamedFallback', '未命名连接');

const getConnectionTags = (conn: ConnectionInfo): TagInfo[] => {
  if (!conn.tag_ids?.length) return [];
  return conn.tag_ids
    .map(id => tags.value.find(tag => tag.id === id))
    .filter((tag): tag is TagInfo => Boolean(tag));
};

const getFolderName = (folderId: number | null | undefined) => {
  if (folderId === null || folderId === undefined) return t('dashboard.noFolder');
  return folders.value.find(folder => folder.id === folderId)?.name || t('dashboard.unknownFolder');
};

const isFailedAction = (actionType: string): boolean => {
  const lowerCaseAction = actionType.toLowerCase();
  return lowerCaseAction.includes('fail') || lowerCaseAction.includes('error') || lowerCaseAction.includes('denied');
};

const getActionTranslation = (actionType: string): string => {
  const key = `auditLog.actions.${actionType}`;
  const translated = t(key);
  return translated === key ? actionType : translated;
};

const getActionIcon = (actionType: string) => {
  if (isFailedAction(actionType)) return 'fa-exclamation-triangle';
  if (actionType.includes('LOGIN')) return 'fa-user-shield';
  if (actionType.includes('CONNECTION') || actionType.includes('SSH')) return 'fa-network-wired';
  if (actionType.includes('TAG')) return 'fa-tags';
  if (actionType.includes('SETTINGS')) return 'fa-gear';
  return 'fa-history';
};

const getActionTone = (actionType: string): DashboardTone => {
  if (isFailedAction(actionType)) return 'danger';
  if (actionType.includes('SUCCESS') || actionType.includes('CREATED')) return 'success';
  return 'neutral';
};

const getSessionStatusLabel = (status: string) => {
  const key = `dashboard.sessionStatus.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
};

const formatAuditDetails = (details: AuditLogEntry['details']) => {
  if (!details) return t('dashboard.activityNoDetails');
  if (typeof details === 'string') return details;
  if ('raw' in details && typeof details.raw === 'string') return details.raw;
  const entries = Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 4);
  if (entries.length === 0) return t('dashboard.activityNoDetails');
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ');
};
</script>

<template>
  <div class="dashboard-view p-4 md:p-6 lg:p-8 bg-background text-foreground">
    <div class="dashboard-shell">
      <section class="dashboard-hero">
        <div class="dashboard-hero__copy">
          <span class="dashboard-eyebrow">{{ t('dashboard.heroEyebrow') }}</span>
          <h1>{{ t('dashboard.title') }}</h1>
          <p>{{ t('dashboard.subtitle') }}</p>
        </div>
        <div class="dashboard-hero__actions">
          <button class="dashboard-button dashboard-button--primary" @click="openAddConnectionForm">
            <i class="fas fa-plus"></i>
            <span>{{ t('dashboard.addConnection') }}</span>
          </button>
          <button class="dashboard-button" @click="navigateTo('Connections')">
            <i class="fas fa-server"></i>
            <span>{{ t('dashboard.viewServers') }}</span>
          </button>
          <button
            class="dashboard-icon-button"
            :class="{ 'is-spinning': isRefreshing }"
            :title="t('dashboard.refresh')"
            :aria-label="t('dashboard.refresh')"
            :disabled="isDashboardLoading"
            @click="refreshDashboard"
          >
            <i class="fas fa-sync-alt"></i>
          </button>
        </div>
      </section>

      <section class="stats-grid" :aria-label="t('dashboard.stats.overview')">
        <article
          v-for="card in statCards"
          :key="card.key"
          class="stat-card"
          :class="`stat-card--${card.tone}`"
        >
          <div class="stat-card__text">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
            <small>{{ card.detail }}</small>
          </div>
          <div class="stat-card__icon">
            <i class="fas" :class="card.icon"></i>
          </div>
        </article>
      </section>

      <section class="dashboard-grid dashboard-grid--main">
        <article class="dashboard-panel dashboard-panel--connections">
          <div class="panel-header">
            <div>
              <span class="panel-kicker">{{ t('dashboard.recentConnections') }}</span>
              <h2>{{ visibleConnectionCountLabel }}</h2>
            </div>
            <RouterLink :to="{ name: 'Connections' }" class="panel-link">
              {{ t('dashboard.viewAllConnections') }}
            </RouterLink>
          </div>

          <div class="dashboard-toolbar">
            <label class="dashboard-search">
              <i class="fas fa-search"></i>
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="t('dashboard.searchConnectionsPlaceholder')"
              />
            </label>

            <select
              v-model="selectedTagId"
              class="dashboard-select"
              :aria-label="t('dashboard.filterTags.ariaLabel')"
              :disabled="isLoadingTags"
            >
              <option :value="null">{{ t('dashboard.filterTags.all') }}</option>
              <option v-for="tag in tags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
            </select>

            <select
              v-model="localSortBy"
              class="dashboard-select"
              :aria-label="t('dashboard.sortBy.ariaLabel')"
            >
              <option v-for="option in sortOptions" :key="option.value" :value="option.value">
                {{ t(option.labelKey) }}
              </option>
            </select>

            <button
              class="dashboard-icon-button dashboard-icon-button--small"
              :aria-label="isAscending ? t('common.sortAscending') : t('common.sortDescending')"
              :title="isAscending ? t('common.sortAscending') : t('common.sortDescending')"
              @click="toggleSortOrder"
            >
              <i :class="['fas', isAscending ? 'fa-arrow-up-a-z' : 'fa-arrow-down-z-a']"></i>
            </button>
          </div>

          <div v-if="isLoadingConnections && dashboardConnections.length === 0" class="empty-state">
            {{ t('common.loading') }}
          </div>

          <div v-else-if="dashboardConnections.length > 0" class="connection-stack">
            <div v-for="conn in dashboardConnections" :key="conn.id" class="connection-row">
              <div class="connection-row__icon" :class="`connection-row__icon--${conn.type.toLowerCase()}`">
                <i
                  class="fas"
                  :class="
                    conn.type === 'SSH'
                      ? 'fa-terminal'
                      : conn.type === 'RDP'
                        ? 'fa-desktop'
                        : 'fa-eye'
                  "
                ></i>
              </div>
              <div class="connection-row__body">
                <div class="connection-row__title">
                  <span :title="getConnectionDisplayName(conn)">{{ getConnectionDisplayName(conn) }}</span>
                  <em>{{ conn.type }}</em>
                </div>
                <div class="connection-row__meta">
                  <span>{{ t('dashboard.lastConnected') }} {{ formatRelativeTime(conn.last_connected_at) }}</span>
                  <span>{{ getFolderName(conn.folder_id) }}</span>
                </div>
                <div v-if="getConnectionTags(conn).length > 0" class="connection-row__tags">
                  <span v-for="tag in getConnectionTags(conn).slice(0, 3)" :key="tag.id">
                    {{ tag.name }}
                  </span>
                  <span v-if="getConnectionTags(conn).length > 3">
                    +{{ getConnectionTags(conn).length - 3 }}
                  </span>
                </div>
              </div>
              <button
                class="connection-row__action"
                :title="t('connections.actions.connect')"
                :aria-label="t('connections.actions.connect')"
                @click="connectTo(conn)"
              >
                <i class="fas fa-arrow-right"></i>
              </button>
            </div>
          </div>

          <div v-else class="empty-state">
            {{
              searchQuery
                ? t('dashboard.noConnectionsMatchSearch')
                : selectedTagId !== null
                  ? t('dashboard.noConnectionsWithTag')
                  : t('dashboard.noConnections')
            }}
          </div>
        </article>

        <aside class="dashboard-panel">
          <div class="panel-header">
            <div>
              <span class="panel-kicker">{{ t('dashboard.assetHealth') }}</span>
              <h2>{{ t('dashboard.protocolDistribution') }}</h2>
            </div>
          </div>

          <div class="protocol-list">
            <div v-for="item in connectionTypeStats" :key="item.type" class="protocol-row">
              <div class="protocol-row__top">
                <span><i class="fas" :class="item.icon"></i>{{ item.type }}</span>
                <strong>{{ item.count }}</strong>
              </div>
              <div class="meter">
                <span :style="{ width: `${item.percent}%` }"></span>
              </div>
            </div>
          </div>

          <div class="organization-list">
            <div
              v-for="item in organizationItems"
              :key="item.key"
              class="organization-row"
              :class="`organization-row--${item.tone}`"
            >
              <div>
                <span>{{ item.label }}</span>
                <strong>{{ item.value }} / {{ item.total }}</strong>
              </div>
              <div class="radial-stat">{{ item.percent }}%</div>
            </div>
          </div>
        </aside>
      </section>

      <section class="dashboard-grid dashboard-grid--secondary">
        <article class="dashboard-panel">
          <div class="panel-header">
            <div>
              <span class="panel-kicker">{{ t('dashboard.recentActivity') }}</span>
              <h2>{{ t('dashboard.activityWindow', { count: recentAuditLogs.length }) }}</h2>
            </div>
            <RouterLink :to="{ name: 'AuditLogs' }" class="panel-link">
              {{ t('dashboard.viewFullAuditLog') }}
            </RouterLink>
          </div>

          <div v-if="isLoadingLogs && recentAuditLogs.length === 0" class="empty-state">
            {{ t('common.loading') }}
          </div>

          <div v-else-if="recentAuditLogs.length > 0" class="timeline-list">
            <div
              v-for="log in recentAuditLogs"
              :key="log.id"
              class="timeline-item"
              :class="`timeline-item--${getActionTone(log.action_type)}`"
            >
              <div class="timeline-item__icon">
                <i class="fas" :class="getActionIcon(log.action_type)"></i>
              </div>
              <div class="timeline-item__body">
                <div>
                  <strong>{{ getActionTranslation(log.action_type) }}</strong>
                  <span>{{ formatRelativeTime(log.timestamp) }}</span>
                </div>
                <p>{{ formatAuditDetails(log.details) }}</p>
              </div>
            </div>
          </div>

          <div v-else class="empty-state">
            {{ t('dashboard.noRecentActivity') }}
          </div>
        </article>

        <article class="dashboard-panel">
          <div class="panel-header">
            <div>
              <span class="panel-kicker">{{ t('dashboard.workspaceOverview') }}</span>
              <h2>{{ t('dashboard.sessionsAndTags') }}</h2>
            </div>
          </div>

          <div class="session-summary">
            <div class="session-summary__main">
              <strong>{{ activeSessionCount }}</strong>
              <span>{{ t('dashboard.stats.activeSessions') }}</span>
            </div>
            <div class="session-summary__details">
              <span>{{ t('dashboard.stats.connectedSessions') }}: {{ connectedSessionCount }}</span>
              <span>{{ t('dashboard.stats.tags') }}: {{ tags.length }}</span>
              <span>{{ t('dashboard.stats.folders') }}: {{ folderCount }}</span>
            </div>
          </div>

          <div v-if="sessionTabsWithStatus.length > 0" class="session-list">
            <div v-for="session in sessionTabsWithStatus.slice(0, 5)" :key="session.sessionId" class="session-row">
              <span>{{ session.connectionName }}</span>
              <em :class="`session-status session-status--${session.status}`">
                {{ getSessionStatusLabel(session.status) }}
              </em>
            </div>
          </div>
          <div v-else class="empty-state empty-state--compact">
            {{ t('dashboard.noActiveSessions') }}
          </div>

          <div class="tag-strip">
            <template v-if="topTags.length === 0">
              <span>{{ t('dashboard.noTaggedConnections') }}</span>
            </template>
            <template v-else>
              <span v-for="tag in topTags" :key="tag.id" :title="`${tag.count}`">
                {{ tag.name }}
                <strong>{{ tag.count }}</strong>
              </span>
            </template>
          </div>
        </article>
      </section>
    </div>

    <AddConnectionForm
      v-if="showAddEditConnectionForm"
      :connectionToEdit="connectionToEdit"
      @close="handleFormClose"
      @connection-added="handleConnectionModified"
      @connection-updated="handleConnectionModified"
    />
  </div>
</template>

<style scoped>
.dashboard-view {
  min-height: 100%;
}

.dashboard-shell {
  width: 100%;
}

.dashboard-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--header-bg-color) 54%, var(--app-bg-color));
  box-shadow: 0 12px 28px color-mix(in srgb, #000 8%, transparent);
}

.dashboard-hero__copy {
  min-width: 0;
}

.dashboard-eyebrow,
.panel-kicker {
  display: block;
  color: var(--text-color-secondary);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.dashboard-hero h1 {
  margin: 0.15rem 0 0.35rem;
  color: var(--text-color);
  font-size: clamp(1.35rem, 2.5vw, 2rem);
  font-weight: 750;
  letter-spacing: 0;
}

.dashboard-hero p {
  max-width: 48rem;
  margin: 0;
  color: var(--text-color-secondary);
  font-size: 0.95rem;
  line-height: 1.6;
}

.dashboard-hero__actions,
.dashboard-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.625rem;
}

.dashboard-button,
.dashboard-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 2.35rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  border-radius: 8px;
  background: var(--app-bg-color);
  color: var(--text-color);
  font-size: 0.875rem;
  font-weight: 650;
  transition: background-color 0.16s ease, border-color 0.16s ease, transform 0.16s ease;
}

.dashboard-button {
  padding: 0.45rem 0.8rem;
  white-space: nowrap;
}

.dashboard-button--primary {
  border-color: var(--button-bg-color);
  background: var(--button-bg-color);
  color: var(--button-text-color);
}

.dashboard-icon-button {
  width: 2.35rem;
  padding: 0;
}

.dashboard-icon-button--small {
  width: 2.1rem;
  min-height: 2.1rem;
}

.dashboard-button:hover,
.dashboard-icon-button:hover {
  border-color: var(--link-active-color);
  background: color-mix(in srgb, var(--link-active-bg-color) 70%, var(--app-bg-color));
  transform: translateY(-1px);
}

.dashboard-button--primary:hover {
  background: var(--button-hover-bg-color);
  color: var(--button-text-color);
}

.dashboard-button i,
.dashboard-icon-button i,
.connection-row__action i,
.panel-link i {
  color: currentColor;
}

.is-spinning i {
  animation: dashboard-spin 0.85s linear infinite;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.stat-card,
.dashboard-panel {
  border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--app-bg-color) 88%, var(--header-bg-color));
  box-shadow: 0 10px 24px color-mix(in srgb, #000 6%, transparent);
}

.stat-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  min-height: 8rem;
  padding: 1rem;
  overflow: hidden;
}

.stat-card__text {
  min-width: 0;
}

.stat-card__text span,
.stat-card__text small {
  display: block;
  color: var(--text-color-secondary);
}

.stat-card__text span {
  font-size: 0.83rem;
  font-weight: 650;
}

.stat-card__text strong {
  display: block;
  margin: 0.35rem 0 0.15rem;
  color: var(--text-color);
  font-size: 2rem;
  font-weight: 800;
  line-height: 1;
}

.stat-card__text small {
  font-size: 0.78rem;
  white-space: nowrap;
}

.stat-card__icon {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-color) 8%, transparent);
  color: var(--text-color);
}

.stat-card--success .stat-card__icon {
  background: color-mix(in srgb, var(--color-success) 13%, transparent);
  color: var(--color-success);
}

.stat-card--warning .stat-card__icon {
  background: color-mix(in srgb, var(--color-warning) 18%, transparent);
  color: color-mix(in srgb, var(--color-warning) 80%, var(--text-color));
}

.stat-card--danger .stat-card__icon {
  background: color-mix(in srgb, var(--color-error) 13%, transparent);
  color: var(--color-error);
}

.stat-card__icon i,
.protocol-row i,
.timeline-item__icon i,
.connection-row__icon i {
  color: currentColor;
}

.dashboard-grid {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
}

.dashboard-grid--main {
  grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.8fr);
}

.dashboard-grid--secondary {
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.85fr);
}

.dashboard-panel {
  min-width: 0;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
}

.panel-header h2 {
  margin: 0.15rem 0 0;
  color: var(--text-color);
  font-size: 1rem;
  font-weight: 750;
}

.panel-link {
  flex-shrink: 0;
  color: var(--link-color);
  font-size: 0.82rem;
  font-weight: 700;
}

.panel-link:hover {
  color: var(--link-hover-color);
}

.dashboard-toolbar {
  padding: 0.85rem 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 55%, transparent);
  background: color-mix(in srgb, var(--header-bg-color) 28%, transparent);
}

.dashboard-search {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex: 1 1 240px;
  min-width: 180px;
  height: 2.1rem;
  padding: 0 0.65rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  border-radius: 8px;
  background: var(--app-bg-color);
  color: var(--text-color-secondary);
}

.dashboard-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-color);
  font-size: 0.86rem;
}

.dashboard-select {
  height: 2.1rem;
  max-width: 10rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  border-radius: 8px;
  background: var(--app-bg-color);
  color: var(--text-color);
  padding: 0 0.6rem;
  font-size: 0.84rem;
}

.connection-stack,
.timeline-list,
.protocol-list,
.organization-list,
.session-list {
  padding: 0.75rem;
}

.connection-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.8rem;
  padding: 0.78rem;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: background-color 0.16s ease, border-color 0.16s ease, transform 0.16s ease;
}

.connection-row + .connection-row {
  margin-top: 0.35rem;
}

.connection-row:hover {
  border-color: color-mix(in srgb, var(--border-color) 72%, transparent);
  background: color-mix(in srgb, var(--header-bg-color) 38%, transparent);
  transform: translateX(2px);
}

.connection-row__icon {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-color) 8%, transparent);
  color: var(--text-color-secondary);
}

.connection-row__icon--ssh {
  color: var(--link-active-color);
}

.connection-row__icon--rdp {
  color: var(--color-success);
}

.connection-row__icon--vnc {
  color: var(--color-warning);
}

.connection-row__body {
  min-width: 0;
}

.connection-row__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.connection-row__title span {
  min-width: 0;
  overflow: hidden;
  color: var(--text-color);
  font-size: 0.92rem;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-row__title em {
  flex-shrink: 0;
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  border-radius: 999px;
  padding: 0.05rem 0.45rem;
  color: var(--text-color-secondary);
  font-size: 0.68rem;
  font-style: normal;
  font-weight: 800;
}

.connection-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.65rem;
  margin-top: 0.15rem;
  color: var(--text-color-secondary);
  font-size: 0.76rem;
}

.connection-row__tags,
.tag-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.45rem;
}

.connection-row__tags span,
.tag-strip span {
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--header-bg-color) 42%, transparent);
  color: var(--text-color-secondary);
  padding: 0.1rem 0.45rem;
  font-size: 0.7rem;
  font-weight: 650;
}

.tag-strip {
  padding: 0 0.75rem 0.85rem;
}

.tag-strip strong {
  margin-left: 0.25rem;
  color: var(--text-color);
}

.connection-row__action {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  border-radius: 8px;
  background: var(--app-bg-color);
  color: var(--text-color-secondary);
  transition: background-color 0.16s ease, color 0.16s ease, transform 0.16s ease;
}

.connection-row__action:hover {
  background: var(--button-bg-color);
  color: var(--button-text-color);
  transform: translateX(2px);
}

.protocol-row + .protocol-row,
.organization-row + .organization-row,
.session-row + .session-row {
  margin-top: 0.75rem;
}

.protocol-row__top,
.session-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.protocol-row__top span {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--text-color);
  font-size: 0.86rem;
  font-weight: 750;
}

.protocol-row__top strong {
  color: var(--text-color-secondary);
  font-size: 0.86rem;
}

.meter {
  height: 0.5rem;
  margin-top: 0.45rem;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border-color) 45%, transparent);
}

.meter span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--link-active-color);
  transition: width 0.25s ease;
}

.organization-list {
  padding-top: 0;
}

.organization-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--header-bg-color) 28%, transparent);
}

.organization-row span,
.session-summary__details,
.session-row,
.timeline-item__body span,
.timeline-item__body p {
  color: var(--text-color-secondary);
  font-size: 0.8rem;
}

.organization-row strong {
  display: block;
  margin-top: 0.15rem;
  color: var(--text-color);
  font-size: 0.95rem;
}

.radial-stat {
  display: grid;
  place-items: center;
  width: 3.2rem;
  height: 3.2rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-color) 8%, transparent);
  color: var(--text-color);
  font-size: 0.78rem;
  font-weight: 800;
}

.organization-row--success .radial-stat {
  background: color-mix(in srgb, var(--color-success) 14%, transparent);
  color: var(--color-success);
}

.organization-row--warning .radial-stat {
  background: color-mix(in srgb, var(--color-warning) 20%, transparent);
  color: color-mix(in srgb, var(--color-warning) 75%, var(--text-color));
}

.timeline-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: 8px;
}

.timeline-item:hover {
  background: color-mix(in srgb, var(--header-bg-color) 34%, transparent);
}

.timeline-item__icon {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-color) 8%, transparent);
  color: var(--text-color-secondary);
}

.timeline-item--success .timeline-item__icon {
  background: color-mix(in srgb, var(--color-success) 13%, transparent);
  color: var(--color-success);
}

.timeline-item--danger .timeline-item__icon {
  background: color-mix(in srgb, var(--color-error) 13%, transparent);
  color: var(--color-error);
}

.timeline-item__body {
  min-width: 0;
}

.timeline-item__body div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.timeline-item__body strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-color);
  font-size: 0.88rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-item__body p {
  display: -webkit-box;
  margin: 0.2rem 0 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: 1.5;
}

.session-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  padding: 0.9rem 0.75rem;
}

.session-summary__main {
  display: grid;
  place-items: center;
  width: 7rem;
  min-height: 6rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--link-active-bg-color) 66%, transparent);
}

.session-summary__main strong {
  color: var(--text-color);
  font-size: 2.15rem;
  font-weight: 850;
  line-height: 1;
}

.session-summary__main span {
  color: var(--text-color-secondary);
  font-size: 0.78rem;
  font-weight: 700;
}

.session-summary__details {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.45rem;
}

.session-row {
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--header-bg-color) 26%, transparent);
}

.session-row span {
  min-width: 0;
  overflow: hidden;
  color: var(--text-color);
  font-size: 0.86rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-status {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  font-size: 0.7rem;
  font-style: normal;
  font-weight: 750;
}

.session-status--connected {
  background: color-mix(in srgb, var(--color-success) 13%, transparent);
  color: var(--color-success);
}

.session-status--connecting {
  background: color-mix(in srgb, var(--color-warning) 18%, transparent);
  color: color-mix(in srgb, var(--color-warning) 78%, var(--text-color));
}

.session-status--error {
  background: color-mix(in srgb, var(--color-error) 13%, transparent);
  color: var(--color-error);
}

.session-status--disconnected {
  background: color-mix(in srgb, var(--text-color) 8%, transparent);
  color: var(--text-color-secondary);
}

.empty-state {
  padding: 2rem 1rem;
  color: var(--text-color-secondary);
  text-align: center;
  font-size: 0.9rem;
}

.empty-state--compact {
  padding: 0.75rem;
}

@keyframes dashboard-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1180px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard-grid--main,
  .dashboard-grid--secondary {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .dashboard-shell {
    width: 100%;
  }

  .dashboard-hero {
    align-items: stretch;
    flex-direction: column;
  }

  .dashboard-hero__actions,
  .dashboard-toolbar {
    width: 100%;
  }

  .dashboard-button {
    flex: 1 1 auto;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }

  .panel-header,
  .timeline-item__body div,
  .session-summary {
    align-items: flex-start;
    grid-template-columns: 1fr;
  }

  .panel-header {
    flex-direction: column;
  }

  .dashboard-select {
    flex: 1 1 130px;
    max-width: none;
  }
}
</style>

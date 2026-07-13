<template>
  <section class="audit-workspace">
    <form class="audit-filters" @submit.prevent="applyFilters">
      <label><span>{{ t('common.search') }}</span><input v-model="searchTerm" :placeholder="t('auditLog.searchPlaceholder')"></label>
      <label><span>{{ t('auditLog.table.actionType') }}</span><select v-model="selectedActionType"><option value="">{{ t('common.all') }}</option><option v-for="type in allActionTypes" :key="type" :value="type">{{ translateActionType(type) }}</option></select></label>
      <label><span>{{ t('auditLog.table.result') }}</span><select v-model="selectedResult"><option value="">{{ t('common.all') }}</option><option value="success">success</option><option value="failure">failure</option><option value="denied">denied</option></select></label>
      <label><span>{{ t('auditLog.startDate', '开始时间') }}</span><input v-model="startDateInput" type="datetime-local"></label>
      <label><span>{{ t('auditLog.endDate', '结束时间') }}</span><input v-model="endDateInput" type="datetime-local"></label>
      <button type="submit" :disabled="store.isLoading"><i class="fas fa-filter"></i>{{ t('common.filter') }}</button>
      <button type="button" class="secondary" @click="resetFilters">{{ t('common.reset') }}</button>
    </form>

    <p v-if="store.error" role="alert" class="audit-error">{{ store.error }}</p>
    <div class="audit-layout">
      <div class="audit-list" :aria-busy="store.isLoading">
        <header><strong>{{ t('auditLog.title') }}</strong><span>{{ t('auditLog.total', { count: totalLogs }) }}</span></header>
        <div class="audit-table-wrap">
          <table>
            <thead><tr><th>{{ t('auditLog.table.timestamp') }}</th><th>{{ t('auditLog.table.actionType') }}</th><th>{{ t('auditLog.table.actor') }}</th><th>{{ t('auditLog.table.result') }}</th><th>{{ t('auditLog.table.sourceIp') }}</th></tr></thead>
            <tbody>
              <tr v-for="log in logs" :key="log.id" :class="{ active: selectedLog?.id === log.id }" tabindex="0" :aria-current="selectedLog?.id === log.id ? 'true' : undefined" @click="selectedLog = log" @keydown.enter="selectedLog = log">
                <td>{{ formatTimestamp(log.timestamp) }}</td><td><strong>{{ translateActionType(log.action_type) }}</strong><small>{{ log.request_id?.slice(0, 12) || '-' }}</small></td><td>{{ actorLabel(log) }}</td><td><span :class="`result-badge ${log.result}`">{{ log.result }}</span></td><td class="mono">{{ log.source_ip || '-' }}</td>
              </tr>
              <tr v-if="!store.isLoading && !logs.length"><td colspan="5" class="empty-state">{{ t('auditLog.noLogs') }}</td></tr>
            </tbody>
          </table>
        </div>
        <footer><span>{{ t('auditLog.paginationInfo', { currentPage, totalPages, totalLogs }) }}</span><div><button type="button" :disabled="currentPage <= 1" @click="changePage(currentPage - 1)"><i class="fas fa-chevron-left"></i></button><button type="button" :disabled="currentPage >= totalPages" @click="changePage(currentPage + 1)"><i class="fas fa-chevron-right"></i></button></div></footer>
      </div>

      <aside class="audit-detail" :aria-label="t('auditLog.detailTitle', '审计详情')">
        <template v-if="selectedLog">
          <header><div><span :class="`result-badge ${selectedLog.result}`">{{ selectedLog.result }}</span><h3>{{ translateActionType(selectedLog.action_type) }}</h3></div><button type="button" class="icon-button" :aria-label="t('common.close')" @click="selectedLog = null"><i class="fas fa-xmark"></i></button></header>
          <dl><div><dt>{{ t('auditLog.table.timestamp') }}</dt><dd>{{ formatTimestamp(selectedLog.timestamp) }}</dd></div><div><dt>{{ t('auditLog.table.actor') }}</dt><dd>{{ actorLabel(selectedLog) }}<small>{{ selectedLog.actor_role || '-' }}</small></dd></div><div><dt>{{ t('auditLog.table.sourceIp') }}</dt><dd class="mono">{{ selectedLog.source_ip || '-' }}</dd></div><div><dt>{{ t('auditLog.table.requestId') }}</dt><dd class="mono selectable">{{ selectedLog.request_id || '-' }}</dd></div><div><dt>Session ID</dt><dd class="mono selectable">{{ selectedLog.session_id || '-' }}</dd></div><div><dt>Asset ID</dt><dd>{{ selectedLog.asset_id || '-' }}</dd></div></dl>
          <section><h4>{{ t('auditLog.table.details') }}</h4><pre>{{ formatDetails(selectedLog.details) || '-' }}</pre></section>
          <button v-if="canInvestigateRecording(selectedLog)" type="button" class="investigate-button" @click="openRelatedRecordings(selectedLog)"><i class="fas fa-video"></i>{{ t('auditLog.openRelatedRecordings', '查看同一操作者附近的录像') }}</button>
          <p v-if="canInvestigateRecording(selectedLog)" class="correlation-hint">{{ t('auditLog.correlationHint', '录像与会话 ID 尚无直接键关联，将按操作者和事件时间窗口筛选。') }}</p>
        </template>
        <div v-else class="detail-placeholder"><i class="fas fa-magnifying-glass-chart"></i><p>{{ t('auditLog.selectHint', '选择一条日志查看完整上下文。') }}</p></div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuditLogStore } from '../stores/audit.store';
import { useSettingsStore } from '../stores/settings.store';
import type { AuditLogActionType, AuditLogEntry } from '../types/server.types';
import { formatDateTimeWithSettings } from '../utils/dateTimeFormat';

const store = useAuditLogStore(); const settingsStore = useSettingsStore(); const router = useRouter();
const { t, locale } = useI18n();
const searchTerm = ref(''); const selectedActionType = ref<AuditLogActionType | ''>(''); const selectedResult = ref<AuditLogEntry['result'] | ''>('');
const startDateInput = ref(''); const endDateInput = ref(''); const selectedLog = ref<AuditLogEntry | null>(null);
const allActionTypes: AuditLogActionType[] = ['LOGIN_SUCCESS','LOGIN_FAILURE','LOGOUT','PASSWORD_CHANGED','USER_CREATED','USER_UPDATED','USER_PASSWORD_RESET','USER_DELETED','GROUP_CREATED','GROUP_UPDATED','GROUP_DELETED','GROUP_MEMBER_SAVED','GROUP_MEMBER_DELETED','CONNECTION_GRANT_SAVED','CONNECTION_GRANTS_BATCH_SAVED','CONNECTION_GRANT_DELETED','BACKUP_CREATED','BACKUP_RESTORE_SCHEDULED','2FA_ENABLED','2FA_DISABLED','CONNECTION_CREATED','CONNECTION_UPDATED','CONNECTION_DELETED','PROXY_CREATED','PROXY_UPDATED','PROXY_DELETED','TAG_CREATED','TAG_UPDATED','TAG_DELETED','SETTINGS_UPDATED','IP_WHITELIST_UPDATED','NOTIFICATION_SETTING_CREATED','NOTIFICATION_SETTING_UPDATED','NOTIFICATION_SETTING_DELETED','SSH_CONNECT_SUCCESS','SSH_CONNECT_FAILURE','SSH_SHELL_FAILURE','DATABASE_MIGRATION','ADMIN_SETUP_COMPLETE'];
const logs = computed(() => store.logs); const totalLogs = computed(() => store.totalLogs); const currentPage = computed(() => store.currentPage); const totalPages = computed(() => Math.max(1, Math.ceil(totalLogs.value / store.logsPerPage)));
const readDateSeconds = (value: string) => value ? Math.floor(new Date(value).getTime() / 1000) : undefined;
const filters = () => ({ searchTerm: searchTerm.value || undefined, actionType: selectedActionType.value || undefined, result: selectedResult.value || undefined, startDate: readDateSeconds(startDateInput.value), endDate: readDateSeconds(endDateInput.value) });
const applyFilters = () => { selectedLog.value = null; void store.fetchLogs({ page: 1, ...filters() }); };
const resetFilters = () => { searchTerm.value=''; selectedActionType.value=''; selectedResult.value=''; startDateInput.value=''; endDateInput.value=''; applyFilters(); };
const changePage = (page: number) => { if (page >= 1 && page <= totalPages.value) { selectedLog.value = null; void store.fetchLogs({ page, ...filters() }); } };
const formatTimestamp = (timestamp: number) => formatDateTimeWithSettings(timestamp * 1000, locale, settingsStore.timezone);
const translateActionType = (type: AuditLogActionType) => { const key=`auditLog.actions.${type}`; const value=t(key); return value===key ? type : value; };
const actorLabel = (log: AuditLogEntry) => log.actor_username || (log.actor_user_id ? `#${log.actor_user_id}` : '-');
const formatDetails = (details: AuditLogEntry['details']) => details && typeof details === 'object' ? JSON.stringify(details, null, 2) : details ? String(details) : '';
const canInvestigateRecording = (log: AuditLogEntry) => log.action_type.startsWith('SSH_') || Boolean(log.session_id);
const openRelatedRecordings = (log: AuditLogEntry) => { void router.replace({ name: 'AdminCenter', query: { section: 'sessionRecordings', recordingQuery: log.actor_username || '', recordingStartedAfter: new Date((log.timestamp - 300) * 1000).toISOString() } }); };
onMounted(() => { void store.fetchLogs(); });
</script>

<style scoped>
.audit-workspace{display:grid;gap:1rem}.audit-filters{display:flex;align-items:end;gap:.6rem;flex-wrap:wrap;padding:1rem;border:1px solid var(--border);border-radius:.75rem;background:var(--card)}.audit-filters label{display:grid;gap:.3rem;flex:1;min-width:10rem}.audit-filters label:first-child{flex:1.4}.audit-filters span{font-size:.75rem;color:var(--muted-foreground)}input,select,button{border:1px solid var(--border);border-radius:.45rem;padding:.55rem .7rem;background:var(--background);color:var(--foreground)}button{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;background:var(--primary);color:var(--primary-foreground);cursor:pointer}.secondary,.icon-button{background:var(--background);color:var(--foreground)}button:disabled{opacity:.5}.audit-error{padding:.7rem;border:1px solid var(--destructive);border-radius:.5rem;color:var(--destructive)}.audit-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(19rem,.36fr);min-height:34rem;border:1px solid var(--border);border-radius:.75rem;overflow:hidden}.audit-list{display:flex;flex-direction:column;min-width:0}.audit-list>header,.audit-list>footer{display:flex;justify-content:space-between;align-items:center;padding:.8rem 1rem;border-bottom:1px solid var(--border)}.audit-list>header span,.audit-list>footer{font-size:.8rem;color:var(--muted-foreground)}.audit-list>footer{margin-top:auto;border-top:1px solid var(--border);border-bottom:0}.audit-list>footer div{display:flex;gap:.4rem}.audit-list>footer button{padding:.4rem .6rem}.audit-table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.82rem}th,td{padding:.7rem;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}th{position:sticky;top:0;background:var(--card);color:var(--muted-foreground);z-index:1}tbody tr{cursor:pointer}tbody tr:hover,tbody tr.active{background:var(--accent)}tbody tr.active{box-shadow:inset 3px 0 var(--primary)}td strong,td small{display:block}td small{margin-top:.2rem;color:var(--muted-foreground)}.mono{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.75rem}.result-badge{display:inline-flex;padding:.2rem .45rem;border-radius:999px;font-size:.7rem;background:var(--muted);color:var(--muted-foreground)}.result-badge.success{background:color-mix(in srgb,var(--success) 15%,transparent);color:var(--success)}.result-badge.failure,.result-badge.denied{background:color-mix(in srgb,var(--destructive) 15%,transparent);color:var(--destructive)}.empty-state{text-align:center;padding:3rem;color:var(--muted-foreground)}.audit-detail{padding:1rem;border-left:1px solid var(--border);background:var(--card);overflow:auto}.audit-detail>header{display:flex;justify-content:space-between;gap:1rem}.audit-detail>header h3{margin:.5rem 0 0;font-size:1.05rem}.icon-button{padding:.4rem .55rem}.audit-detail dl{display:grid;gap:.7rem;margin:1rem 0}.audit-detail dl div{display:grid;gap:.2rem}.audit-detail dt{font-size:.7rem;color:var(--muted-foreground)}.audit-detail dd{display:grid;margin:0}.audit-detail dd small{color:var(--muted-foreground)}.selectable{user-select:text;white-space:normal;overflow-wrap:anywhere}.audit-detail h4{margin:0 0 .5rem}.audit-detail pre{max-height:18rem;overflow:auto;padding:.75rem;border:1px solid var(--border);border-radius:.5rem;background:var(--background);white-space:pre-wrap;overflow-wrap:anywhere;font-size:.75rem}.investigate-button{width:100%;margin-top:.8rem}.correlation-hint{font-size:.72rem;color:var(--muted-foreground);line-height:1.45}.detail-placeholder{display:grid;place-content:center;min-height:24rem;text-align:center;color:var(--muted-foreground)}.detail-placeholder i{font-size:2rem}@media(max-width:1000px){.audit-layout{grid-template-columns:1fr}.audit-detail{border-left:0;border-top:1px solid var(--border)}}
</style>

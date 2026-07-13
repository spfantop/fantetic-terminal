<template>
  <section class="audit-workspace">
    <form class="audit-filters" @submit.prevent="applyFilters">
      <label class="audit-filter-field audit-filter-search"><span>{{ t('common.search') }}</span><input v-model="searchTerm" :placeholder="t('auditLog.searchPlaceholder')"></label>
      <label class="audit-filter-field audit-filter-action"><span>{{ t('auditLog.table.actionType') }}</span><select v-model="selectedActionType"><option value="">{{ t('common.all') }}</option><option v-for="type in allActionTypes" :key="type" :value="type">{{ translateActionType(type) }}</option></select></label>
      <label class="audit-filter-field audit-filter-result"><span>{{ t('auditLog.table.result') }}</span><select v-model="selectedResult"><option value="">{{ t('common.all') }}</option><option value="success">{{ t('auditLog.results.success') }}</option><option value="failure">{{ t('auditLog.results.failure') }}</option><option value="denied">{{ t('auditLog.results.denied') }}</option></select></label>
      <AdminDateRange v-model:start="startDateInput" v-model:end="endDateInput" :label="t('adminDateRange.range')" />
      <div class="audit-filter-actions"><button type="submit" :disabled="store.isLoading"><i class="fas fa-filter"></i>{{ t('common.filter') }}</button><button type="button" class="secondary" @click="resetFilters">{{ t('common.reset') }}</button></div>
    </form>

    <p v-if="filterValidationError || store.error" role="alert" class="audit-error">{{ filterValidationError || store.error }}</p>
    <div class="audit-layout">
      <div class="audit-list" :aria-busy="store.isLoading">
        <header><strong>{{ t('auditLog.title') }}</strong><span>{{ t('auditLog.total', { count: totalLogs }) }}</span></header>
        <div class="audit-table-wrap">
          <table>
            <thead><tr><th>{{ t('auditLog.table.timestamp') }}</th><th>{{ t('auditLog.table.actionType') }}</th><th>{{ t('auditLog.table.actor') }}</th><th>{{ t('auditLog.table.result') }}</th><th>{{ t('auditLog.table.sourceIp') }}</th></tr></thead>
            <tbody>
              <template v-for="log in logs" :key="log.id"><tr :class="{ active: selectedLog?.id === log.id }" tabindex="0" :aria-current="selectedLog?.id === log.id ? 'true' : undefined" @click="selectedLog = selectedLog?.id === log.id ? null : log" @keydown.enter="selectedLog = selectedLog?.id === log.id ? null : log"><td>{{ formatTimestamp(log.timestamp) }}</td><td><strong>{{ translateActionType(log.action_type) }}</strong><small>{{ log.request_id?.slice(0, 12) || '-' }}</small></td><td>{{ actorLabel(log) }}</td><td><span :class="`result-badge ${log.result}`">{{ t(`auditLog.results.${log.result}`) }}</span></td><td class="mono">{{ log.source_ip || '-' }}</td></tr>
              <tr v-if="selectedLog?.id === log.id" class="audit-detail-row"><td colspan="5"><div class="detail-line"><span><b>{{ t('auditLog.table.sessionId') }}</b>{{ log.session_id || '-' }}</span><span><b>{{ t('auditLog.table.assetId') }}</b>{{ log.asset_id || '-' }}</span><span><b>{{ t('auditLog.table.requestId') }}</b>{{ log.request_id || '-' }}</span><span class="detail-json"><b>{{ t('auditLog.table.details') }}</b>{{ formatDetails(log.details) || '-' }}</span><button v-if="canInvestigateRecording(log)" type="button" @click.stop="openRelatedRecordings(log)"><i class="fas fa-video"></i>{{ t('auditLog.openRelatedRecordings') }}</button></div></td></tr></template>
              <tr v-if="!store.isLoading && !logs.length"><td colspan="5" class="empty-state">{{ t('auditLog.noLogs') }}</td></tr>
            </tbody>
          </table>
        </div>
        <AdminPagination :page="currentPage" :page-count="totalPages" :total="totalLogs" :disabled="store.isLoading" @update:page="changePage" />
      </div>

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
import AdminPagination from '../components/admin/AdminPagination.vue';
import AdminDateRange from '../components/admin/AdminDateRange.vue';

const store = useAuditLogStore(); const settingsStore = useSettingsStore(); const router = useRouter();
const { t, locale } = useI18n();
const searchTerm = ref(''); const selectedActionType = ref<AuditLogActionType | ''>(''); const selectedResult = ref<AuditLogEntry['result'] | ''>('');
const startDateInput = ref(''); const endDateInput = ref(''); const selectedLog = ref<AuditLogEntry | null>(null);
const filterValidationError = ref('');
const allActionTypes: AuditLogActionType[] = ['LOGIN_SUCCESS','LOGIN_FAILURE','LOGOUT','PASSWORD_CHANGED','USER_CREATED','USER_UPDATED','USER_PASSWORD_RESET','USER_DELETED','GROUP_CREATED','GROUP_UPDATED','GROUP_DELETED','GROUP_MEMBER_SAVED','GROUP_MEMBER_DELETED','CONNECTION_GRANT_SAVED','CONNECTION_GRANTS_BATCH_SAVED','CONNECTION_GRANT_DELETED','BACKUP_CREATED','BACKUP_RESTORE_SCHEDULED','2FA_ENABLED','2FA_DISABLED','CONNECTION_CREATED','CONNECTION_UPDATED','CONNECTION_DELETED','PROXY_CREATED','PROXY_UPDATED','PROXY_DELETED','TAG_CREATED','TAG_UPDATED','TAG_DELETED','SETTINGS_UPDATED','IP_WHITELIST_UPDATED','NOTIFICATION_SETTING_CREATED','NOTIFICATION_SETTING_UPDATED','NOTIFICATION_SETTING_DELETED','SSH_CONNECT_SUCCESS','SSH_CONNECT_FAILURE','SSH_SHELL_FAILURE','DATABASE_MIGRATION','ADMIN_SETUP_COMPLETE'];
const logs = computed(() => store.logs); const totalLogs = computed(() => store.totalLogs); const currentPage = computed(() => store.currentPage); const totalPages = computed(() => Math.max(1, Math.ceil(totalLogs.value / store.logsPerPage)));
const readDateSeconds = (value: string, endOfDay = false) => value ? Math.floor(new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}`).getTime() / 1000) : undefined;
const filters = () => ({ searchTerm: searchTerm.value || undefined, actionType: selectedActionType.value || undefined, result: selectedResult.value || undefined, startDate: readDateSeconds(startDateInput.value), endDate: readDateSeconds(endDateInput.value, true) });
const applyFilters = () => { filterValidationError.value=''; if(startDateInput.value&&endDateInput.value&&startDateInput.value>endDateInput.value){filterValidationError.value=t('adminDateRange.invalidRange');return;} selectedLog.value = null; void store.fetchLogs({ page: 1, ...filters() }); };
const resetFilters = () => { searchTerm.value=''; selectedActionType.value=''; selectedResult.value=''; startDateInput.value=''; endDateInput.value=''; filterValidationError.value=''; applyFilters(); };
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
.audit-workspace{container-type:inline-size}.audit-workspace .audit-filters{display:grid;grid-template-columns:minmax(12rem,1.3fr) minmax(11rem,1fr) minmax(9rem,.8fr) minmax(20rem,1.45fr) auto;align-items:end;gap:.75rem}.audit-workspace .audit-filter-field{display:grid;grid-template-rows:auto 2.55rem;gap:.3rem;min-width:0}.audit-workspace .audit-filter-field input,.audit-workspace .audit-filter-field select{box-sizing:border-box;width:100%;min-width:0}.audit-filter-actions{display:flex;align-items:center;gap:.5rem}.audit-filter-actions button{white-space:nowrap;min-width:5.5rem}@container(max-width:72rem){.audit-workspace .audit-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.audit-filter-actions{grid-column:1/-1;justify-content:flex-end}}@container(max-width:40rem){.audit-workspace .audit-filters{grid-template-columns:1fr}.audit-filter-actions{grid-column:auto}.audit-filter-actions button{flex:1}}
.audit-workspace .audit-layout{display:block}.audit-detail-row td{padding:.7rem 1rem;background:var(--card);white-space:normal}.detail-line{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}.detail-line span{display:flex;gap:.35rem;min-width:0}.detail-line b{color:var(--muted-foreground);font-weight:500}.detail-json{flex:1;overflow-wrap:anywhere}.detail-line button{margin-left:auto}
.audit-workspace button{background:var(--background);color:var(--foreground)}.audit-workspace .audit-filters button[type="submit"]{background:var(--primary);color:var(--primary-foreground)}
.audit-workspace{display:grid;gap:1rem}.audit-filters{display:flex;align-items:end;gap:.6rem;flex-wrap:wrap;padding:1rem;border:1px solid var(--border);border-radius:.75rem;background:var(--card)}.audit-filters label{display:grid;gap:.3rem;flex:1;min-width:10rem}.audit-filters label:first-child{flex:1.4}.audit-filters span{font-size:.75rem;color:var(--muted-foreground)}input,select,button{border:1px solid var(--border);border-radius:.45rem;padding:.55rem .7rem;background:var(--background);color:var(--foreground)}button{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;background:var(--primary);color:var(--primary-foreground);cursor:pointer}.secondary,.icon-button{background:var(--background);color:var(--foreground)}button:disabled{opacity:.5}.audit-error{padding:.7rem;border:1px solid var(--destructive);border-radius:.5rem;color:var(--destructive)}.audit-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(19rem,.36fr);min-height:34rem;border:1px solid var(--border);border-radius:.75rem;overflow:hidden}.audit-list{display:flex;flex-direction:column;min-width:0}.audit-list>header,.audit-list>footer{display:flex;justify-content:space-between;align-items:center;padding:.8rem 1rem;border-bottom:1px solid var(--border)}.audit-list>header span,.audit-list>footer{font-size:.8rem;color:var(--muted-foreground)}.audit-list>footer{margin-top:auto;border-top:1px solid var(--border);border-bottom:0}.audit-list>footer div{display:flex;gap:.4rem}.audit-list>footer button{padding:.4rem .6rem}.audit-table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:.82rem}th,td{padding:.7rem;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}th{position:sticky;top:0;background:var(--card);color:var(--muted-foreground);z-index:1}tbody tr{cursor:pointer}tbody tr:hover,tbody tr.active{background:var(--accent)}tbody tr.active{box-shadow:inset 3px 0 var(--primary)}td strong,td small{display:block}td small{margin-top:.2rem;color:var(--muted-foreground)}.mono{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.75rem}.result-badge{display:inline-flex;padding:.2rem .45rem;border-radius:999px;font-size:.7rem;background:var(--muted);color:var(--muted-foreground)}.result-badge.success{background:color-mix(in srgb,var(--success) 15%,transparent);color:var(--success)}.result-badge.failure,.result-badge.denied{background:color-mix(in srgb,var(--destructive) 15%,transparent);color:var(--destructive)}.empty-state{text-align:center;padding:3rem;color:var(--muted-foreground)}.audit-detail{padding:1rem;border-left:1px solid var(--border);background:var(--card);overflow:auto}.audit-detail>header{display:flex;justify-content:space-between;gap:1rem}.audit-detail>header h3{margin:.5rem 0 0;font-size:1.05rem}.icon-button{padding:.4rem .55rem}.audit-detail dl{display:grid;gap:.7rem;margin:1rem 0}.audit-detail dl div{display:grid;gap:.2rem}.audit-detail dt{font-size:.7rem;color:var(--muted-foreground)}.audit-detail dd{display:grid;margin:0}.audit-detail dd small{color:var(--muted-foreground)}.selectable{user-select:text;white-space:normal;overflow-wrap:anywhere}.audit-detail h4{margin:0 0 .5rem}.audit-detail pre{max-height:18rem;overflow:auto;padding:.75rem;border:1px solid var(--border);border-radius:.5rem;background:var(--background);white-space:pre-wrap;overflow-wrap:anywhere;font-size:.75rem}.investigate-button{width:100%;margin-top:.8rem}.correlation-hint{font-size:.72rem;color:var(--muted-foreground);line-height:1.45}.detail-placeholder{display:grid;place-content:center;min-height:24rem;text-align:center;color:var(--muted-foreground)}.detail-placeholder i{font-size:2rem}@media(max-width:1000px){.audit-layout{grid-template-columns:1fr}.audit-detail{border-left:0;border-top:1px solid var(--border)}}
</style>

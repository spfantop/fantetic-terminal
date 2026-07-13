<template>
  <div ref="adminDialogRootRef" :class="['admin-center-root', props.isDialog ? 'admin-center-dialog-layer' : 'admin-center-page']" @click.self="handleBackdropClick">
  <main
    ref="adminDialogRef"
    :class="['admin-center', { 'admin-center-dialog-shell': props.isDialog }]"
    :role="props.isDialog ? 'dialog' : undefined"
    :aria-modal="props.isDialog ? 'true' : undefined"
    :aria-label="props.isDialog ? t('adminCenter.title', '管理中心') : undefined"
  >
    <header v-if="!props.isDialog" class="admin-center-header">
      <h1>{{ t('adminCenter.title', '管理中心') }}</h1>
    </header>

    <div class="admin-center-layout">
      <aside class="admin-center-navigation" :aria-label="t('adminCenter.navigation', '管理中心导航')">
        <section v-for="group in navigationGroups" :key="group.label" class="admin-nav-group">
          <h2>{{ group.label }}</h2>
          <button
            v-for="item in group.items"
            :key="item.key"
            type="button"
            :class="['admin-nav-item', { active: activeSection === item.key }]"
            :aria-current="activeSection === item.key ? 'page' : undefined"
            @click="selectSection(item.key)"
          >
            <i :class="item.icon" aria-hidden="true"></i>
            <span>{{ item.label }}</span>
          </button>
        </section>
      </aside>

      <section class="admin-center-content" :aria-labelledby="`admin-section-${activeSection}`">
        <header class="admin-section-header admin-dialog-drag-handle" @pointerdown="startAdminDialogDrag">
          <i :class="activeItem.icon" aria-hidden="true"></i>
          <h2 :id="`admin-section-${activeSection}`">{{ activeItem.label }}</h2>
          <button v-if="props.isDialog" type="button" class="admin-center-close" :aria-label="t('common.close')" @click="closeDialog"><i class="fas fa-xmark" aria-hidden="true"></i></button>
        </header>

        <div v-if="activeSection === 'overview'" class="admin-overview">
          <div class="admin-overview-stats" :aria-busy="overviewLoading">
            <button v-for="stat in visibleStats" :key="stat.key" type="button" @click="selectSection(stat.section)"><i :class="stat.icon"></i><span>{{ stat.label }}</span><strong v-if="overviewStats[stat.key] !== null">{{ overviewStats[stat.key] }}</strong><i v-else-if="overviewLoading" class="fas fa-spinner fa-spin overview-loading"></i><em v-else>—</em></button>
          </div>
        </div>
        <AccessControlSettings v-else-if="activeSection === 'accessControl'" />
        <AuditLogView v-else-if="activeSection === 'auditLogs'" />
        <SessionRecordingSettings v-else-if="activeSection === 'sessionRecordings'" />
        <DataManagementSection v-else-if="activeSection === 'dataManagement'" />
      </section>
    </div>
  </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore, type SystemRole } from '../stores/auth.store';
import AccessControlSettings from '../components/settings/AccessControlSettings.vue';
import SessionRecordingSettings from '../components/settings/SessionRecordingSettings.vue';
import DataManagementSection from '../components/settings/DataManagementSection.vue';
import AuditLogView from './AuditLogView.vue';
import { accessControlApi } from '../services/accessControl.api';
import { sessionRecordingApi } from '../services/sessionRecording.api';
import { backupApi } from '../services/backup.api';
import apiClient from '../utils/apiClient';
import { useDraggableDialog } from '../composables/useDraggableDialog';

type AdminSection = 'overview' | 'accessControl' | 'auditLogs' | 'sessionRecordings' | 'dataManagement';
interface AdminNavigationItem {
  key: AdminSection;
  label: string;
  icon: string;
  roles: SystemRole[];
}

const props = withDefaults(defineProps<{ isDialog?: boolean }>(), { isDialog: false });
const emit = defineEmits<{ close: [] }>();
const adminDialogRootRef = ref<HTMLElement | null>(null);
const adminDialogRef = ref<HTMLElement | null>(null);
const { centerDialog: centerAdminDialog, startDialogDrag: startAdminDialogDrag } = useDraggableDialog({
  rootRef: adminDialogRootRef,
  dialogRef: adminDialogRef,
  disabled: () => !props.isDialog || window.innerWidth <= 768,
  resizable: false,
  margin: 12,
});

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const administratorRoles: SystemRole[] = ['super_admin', 'admin'];
const auditRoles: SystemRole[] = [...administratorRoles, 'auditor'];
type OverviewStatKey = 'users' | 'groups' | 'assets' | 'auditLogs' | 'recordings' | 'backups';
const overviewLoading = ref(false);
const overviewStats = ref<Record<OverviewStatKey, number | null>>({ users:null,groups:null,assets:null,auditLogs:null,recordings:null,backups:null });
const visibleStats = computed(() => {
  const common = [
    { key:'auditLogs' as const,section:'auditLogs' as const,label:t('nav.auditLogs'),icon:'fas fa-shield-halved' },
    { key:'recordings' as const,section:'sessionRecordings' as const,label:t('sessionRecording.title'),icon:'fas fa-video' },
  ];
  if (!administratorRoles.includes(authStore.user?.systemRole ?? 'user')) return common;
  return [
    { key:'users' as const,section:'accessControl' as const,label:t('accessControl.users'),icon:'fas fa-user-shield' },
    { key:'groups' as const,section:'accessControl' as const,label:t('accessControl.groups'),icon:'fas fa-users' },
    { key:'assets' as const,section:'accessControl' as const,label:t('accessControl.assetPermissions'),icon:'fas fa-server' },
    ...common,
    { key:'backups' as const,section:'dataManagement' as const,label:t('backup.title'),icon:'fas fa-box-archive' },
  ];
});

const allItems = computed<AdminNavigationItem[]>(() => [
  { key: 'overview', label: t('adminCenter.sections.overview', '概览'), icon: 'fas fa-grid-2', roles: auditRoles },
  { key: 'accessControl', label: t('accessControl.title', '访问控制'), icon: 'fas fa-users-gear', roles: administratorRoles },
  { key: 'auditLogs', label: t('nav.auditLogs', '审计日志'), icon: 'fas fa-shield-halved', roles: auditRoles },
  { key: 'sessionRecordings', label: t('sessionRecording.title', '会话录像'), icon: 'fas fa-video', roles: auditRoles },
  { key: 'dataManagement', label: t('settings.tabs.dataManagement', '数据管理'), icon: 'fas fa-database', roles: administratorRoles },
]);
const allowedItems = computed(() => {
  const role = authStore.user?.systemRole;
  return role ? allItems.value.filter(item => item.roles.includes(role)) : [];
});
const requestedSection = computed(() => {
  const value = Array.isArray(route.query.section) ? route.query.section[0] : route.query.section;
  return allowedItems.value.some(item => item.key === value) ? value as AdminSection : 'overview';
});
const activeSection = computed(() => requestedSection.value);
const activeItem = computed(() => allowedItems.value.find(item => item.key === activeSection.value) ?? allItems.value[0]!);
const navigationGroups = computed(() => [
  { label: t('adminCenter.groups.workspace', '管理概览'), items: allowedItems.value.filter(item => item.key === 'overview') },
  { label: t('adminCenter.groups.identity', '身份与资产'), items: allowedItems.value.filter(item => item.key === 'accessControl') },
  { label: t('adminCenter.groups.audit', '审计与合规'), items: allowedItems.value.filter(item => ['auditLogs', 'sessionRecordings'].includes(item.key)) },
  { label: t('adminCenter.groups.system', '系统运维'), items: allowedItems.value.filter(item => item.key === 'dataManagement') },
].filter(group => group.items.length > 0));

const selectSection = (section: AdminSection) => {
  const sectionQuery = section === 'overview' ? {} : { section };
  void router.replace(props.isDialog
    ? { name: 'Connections', query: { admin: '1', ...sectionQuery } }
    : { name: 'AdminCenter', query: sectionQuery });
};

const closeDialog = () => emit('close');
const handleBackdropClick = () => { if (props.isDialog) closeDialog(); };
const handleKeydown = (event: KeyboardEvent) => { if (props.isDialog && event.key === 'Escape') closeDialog(); };

const loadOverviewStats = async () => {
  overviewLoading.value = true;
  const jobs: Array<{key:OverviewStatKey;load:()=>Promise<number>}> = [
    { key:'auditLogs',load:async()=>Number((await apiClient.get<{total:number}>('/audit-logs',{params:{limit:1,offset:0}})).data.total) },
    { key:'recordings',load:async()=>Number((await sessionRecordingApi.list({limit:1,offset:0})).total) },
  ];
  if (administratorRoles.includes(authStore.user?.systemRole ?? 'user')) jobs.push(
    {key:'users',load:async()=>(await accessControlApi.listUsers()).length},
    {key:'groups',load:async()=>(await accessControlApi.listGroups()).length},
    {key:'assets',load:async()=>(await accessControlApi.listConnections()).length},
    {key:'backups',load:async()=>(await backupApi.list()).length},
  );
  const results=await Promise.allSettled(jobs.map(job=>job.load()));
  results.forEach((result,index)=>{overviewStats.value[jobs[index]!.key]=result.status==='fulfilled'?result.value:null;});
  overviewLoading.value=false;
};

watch(requestedSection, section => {
  const raw = Array.isArray(route.query.section) ? route.query.section[0] : route.query.section;
  if (raw && raw !== section) selectSection(section);
}, { immediate: true });
onMounted(() => { window.addEventListener('keydown', handleKeydown); if (props.isDialog) void centerAdminDialog(); void loadOverviewStats(); });
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown));
</script>

<style scoped>
.admin-center{--admin-font-xs:.75rem;--admin-font-sm:.8125rem;--admin-font-base:.875rem;--admin-font-title:1.25rem;font-size:var(--admin-font-base)}
.admin-center{--background:var(--app-bg-color);--foreground:var(--text-color);--border:var(--border-color);--card:var(--app-bg-color);--muted:var(--header-bg-color);--muted-foreground:var(--text-color-secondary);--primary:var(--link-active-color);--primary-foreground:var(--button-text-color);--accent:var(--nav-item-active-bg-color);--destructive:var(--color-error);--destructive-foreground:var(--color-error-text);--success:var(--color-success);--warning:var(--color-warning);min-height:100vh;padding:1rem;color:var(--text-color);background:var(--app-bg-color)}
.admin-center-dialog-layer{position:fixed;inset:0;z-index:1060;padding:clamp(1rem,2vw,2rem);background:transparent;pointer-events:none;overflow:auto}.admin-center-dialog-shell{position:absolute;left:50%;top:50%;width:min(82rem,calc(100dvw - 2rem));height:min(50rem,calc(100dvh - 2rem));min-height:0;padding:0;border:1px solid var(--border-color);border-radius:.85rem;box-shadow:0 24px 72px rgba(15,23,42,.22);overflow:hidden;pointer-events:auto;transform:translate(-50%,-50%)}.admin-center-dialog-shell .admin-center-layout{width:100%;max-width:none;height:100%;min-height:0;margin:0;border:0;border-radius:0}.admin-center-close{display:inline-grid;place-content:center;width:2.25rem;height:2.25rem;margin-left:auto;padding:0;border:1px solid transparent;border-radius:.65rem;background:transparent;color:var(--text-color-secondary);cursor:pointer}.admin-center-close:hover,.admin-center-close:focus-visible{border-color:var(--border-color);background:var(--nav-item-active-bg-color);color:var(--text-color);outline:none}
.admin-center-header{max-width:82rem;margin:0 auto .75rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}.admin-center-header h1{margin:0;font-size:1.45rem;line-height:1.2}.admin-center-back{display:inline-flex;align-items:center;gap:.5rem;padding:.5rem .7rem;border:1px solid var(--border-color);border-radius:.5rem;color:var(--text-color);font-size:.85rem;text-decoration:none}.admin-center-back:hover,.admin-center-back:focus-visible{background:var(--nav-item-active-bg-color);color:var(--link-active-color);outline:none}
.admin-center-layout{max-width:82rem;height:calc(100dvh - 4.5rem);min-height:30rem;margin:0 auto;display:grid;grid-template-columns:16rem minmax(0,1fr);border:1px solid var(--border-color);border-radius:.75rem;overflow:hidden;background:var(--app-bg-color)}
.admin-center-navigation{padding:.75rem;border-right:1px solid var(--border-color);background:var(--header-bg-color);overflow-y:auto}.admin-nav-group+.admin-nav-group{margin-top:1rem}.admin-nav-group h2{margin:0 .75rem .35rem;color:var(--text-color-secondary);font-size:.72rem;font-weight:600}.admin-nav-item{width:100%;display:flex;align-items:center;gap:.75rem;padding:.6rem .85rem;border:1px solid transparent;border-radius:.6rem;color:var(--text-color);background:transparent;text-align:left;cursor:pointer}.admin-nav-item i{width:1.2rem;color:currentColor;text-align:center}.admin-nav-item:hover,.admin-nav-item:focus-visible{border-color:var(--border-color);color:var(--link-hover-color);outline:none}.admin-nav-item.active{border-color:color-mix(in srgb,var(--link-active-color) 42%,var(--border-color));background:var(--nav-item-active-bg-color);color:var(--link-active-color)}
.admin-center-content{min-width:0;overflow:auto;background:var(--app-bg-color)}.admin-section-header{display:flex;align-items:center;gap:.75rem;padding:1rem 1.25rem;border-bottom:1px solid var(--border-color);background:var(--app-bg-color)}.admin-dialog-drag-handle{cursor:move;user-select:none}.admin-section-header i{display:grid;place-content:center;width:2rem;height:2rem;border-radius:.55rem;background:var(--nav-item-active-bg-color);color:var(--link-active-color)}.admin-section-header h2{margin:0;font-size:1.25rem}.admin-center-content>:not(.admin-section-header){margin:1rem 1.25rem 1.25rem}
.admin-center-content :deep(input),.admin-center-content :deep(select),.admin-center-content :deep(button),.admin-center-content :deep(table){font-size:var(--admin-font-sm)}.admin-center-content :deep(label),.admin-center-content :deep(p),.admin-center-content :deep(dd){font-size:var(--admin-font-base)}.admin-center-content :deep(dt),.admin-center-content :deep(small){font-size:var(--admin-font-xs)}
.admin-overview{display:grid;gap:.75rem}.admin-overview-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem}.admin-overview-stats button{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:.65rem;padding:.8rem;border:1px solid var(--border-color);border-radius:.55rem;background:var(--app-bg-color);color:var(--text-color);text-align:left;cursor:pointer}.admin-overview-stats button:hover,.admin-overview-stats button:focus-visible{border-color:color-mix(in srgb,var(--link-active-color) 42%,var(--border-color));background:var(--nav-item-active-bg-color);color:var(--link-active-color);outline:none}.admin-overview-stats button>i:first-child{color:currentColor}.admin-overview-stats button span{font-size:.78rem;color:currentColor}.admin-overview-stats button strong{font-size:1.15rem}.admin-overview-stats button em{font-style:normal;color:var(--text-color-secondary)}
@media (max-width: 760px) {
  .admin-center { padding: .5rem; }
  .admin-center-header { align-items: center; }
  .admin-center-layout { display: block; height:calc(100dvh - 3.75rem); }
  .admin-center-navigation { display: flex; gap: .35rem; padding:.5rem; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border-color); }
  .admin-nav-group { display: contents; }
  .admin-nav-group h2 { display: none; }
  .admin-nav-item { width: auto; white-space: nowrap; }
  .admin-center-content { height:calc(100% - 3.3rem); }
  .admin-overview-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .admin-center-dialog-layer { padding: 1rem; }
  .admin-center-dialog-shell { width:calc(100dvw - 2rem);height:calc(100dvh - 2rem);min-height:0;padding:0;border-radius:.75rem; }
  .admin-center-dialog-shell .admin-center-layout { height:100%; }
  .admin-dialog-drag-handle { cursor:default; }
}
</style>

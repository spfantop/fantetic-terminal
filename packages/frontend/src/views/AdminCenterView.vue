<template>
  <main class="admin-center">
    <header class="admin-center-header">
      <div>
        <p class="admin-center-eyebrow">{{ t('adminCenter.eyebrow', '平台治理') }}</p>
        <h1>{{ t('adminCenter.title', '管理中心') }}</h1>
        <p>{{ t('adminCenter.description', '集中管理身份、资产权限、审计记录与系统数据。') }}</p>
      </div>
      <RouterLink :to="{ name: 'Connections' }" class="admin-center-back">
        <i class="fas fa-arrow-left" aria-hidden="true"></i>
        {{ t('adminCenter.back', '返回工作区') }}
      </RouterLink>
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
        <header class="admin-section-header">
          <div>
            <h2 :id="`admin-section-${activeSection}`">{{ activeItem.label }}</h2>
            <p>{{ activeItem.description }}</p>
          </div>
        </header>

        <div v-if="activeSection === 'overview'" class="admin-overview-grid">
          <button
            v-for="item in overviewItems"
            :key="item.key"
            type="button"
            class="admin-overview-card"
            @click="selectSection(item.key)"
          >
            <i :class="item.icon" aria-hidden="true"></i>
            <span>
              <strong>{{ item.label }}</strong>
              <small>{{ item.description }}</small>
            </span>
            <i class="fas fa-chevron-right" aria-hidden="true"></i>
          </button>
        </div>
        <AccessControlSettings v-else-if="activeSection === 'accessControl'" />
        <AuditLogView v-else-if="activeSection === 'auditLogs'" />
        <SessionRecordingSettings v-else-if="activeSection === 'sessionRecordings'" />
        <DataManagementSection v-else-if="activeSection === 'dataManagement'" />
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore, type SystemRole } from '../stores/auth.store';
import AccessControlSettings from '../components/settings/AccessControlSettings.vue';
import SessionRecordingSettings from '../components/settings/SessionRecordingSettings.vue';
import DataManagementSection from '../components/settings/DataManagementSection.vue';
import AuditLogView from './AuditLogView.vue';

type AdminSection = 'overview' | 'accessControl' | 'auditLogs' | 'sessionRecordings' | 'dataManagement';
interface AdminNavigationItem {
  key: AdminSection;
  label: string;
  description: string;
  icon: string;
  roles: SystemRole[];
}

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const administratorRoles: SystemRole[] = ['super_admin', 'admin'];
const auditRoles: SystemRole[] = [...administratorRoles, 'auditor'];

const allItems = computed<AdminNavigationItem[]>(() => [
  { key: 'overview', label: t('adminCenter.sections.overview', '概览'), description: t('adminCenter.descriptions.overview', '按职责快速进入各项管理能力。'), icon: 'fas fa-grid-2', roles: auditRoles },
  { key: 'accessControl', label: t('accessControl.title', '访问控制'), description: t('adminCenter.descriptions.accessControl', '管理用户、用户组和连接资产授权。'), icon: 'fas fa-users-gear', roles: administratorRoles },
  { key: 'auditLogs', label: t('nav.auditLogs', '审计日志'), description: t('adminCenter.descriptions.auditLogs', '检索关键操作并追踪责任主体。'), icon: 'fas fa-shield-halved', roles: auditRoles },
  { key: 'sessionRecordings', label: t('sessionRecording.title', '会话录像'), description: t('adminCenter.descriptions.sessionRecordings', '查看终端会话记录和回放。'), icon: 'fas fa-video', roles: auditRoles },
  { key: 'dataManagement', label: t('settings.tabs.dataManagement', '数据管理'), description: t('adminCenter.descriptions.dataManagement', '执行导入、导出、备份和恢复。'), icon: 'fas fa-database', roles: administratorRoles },
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
const overviewItems = computed(() => allowedItems.value.filter(item => item.key !== 'overview'));
const navigationGroups = computed(() => [
  { label: t('adminCenter.groups.workspace', '管理概览'), items: allowedItems.value.filter(item => item.key === 'overview') },
  { label: t('adminCenter.groups.identity', '身份与资产'), items: allowedItems.value.filter(item => item.key === 'accessControl') },
  { label: t('adminCenter.groups.audit', '审计与合规'), items: allowedItems.value.filter(item => ['auditLogs', 'sessionRecordings'].includes(item.key)) },
  { label: t('adminCenter.groups.system', '系统运维'), items: allowedItems.value.filter(item => item.key === 'dataManagement') },
].filter(group => group.items.length > 0));

const selectSection = (section: AdminSection) => {
  void router.replace({ name: 'AdminCenter', query: section === 'overview' ? {} : { section } });
};

watch(requestedSection, section => {
  const raw = Array.isArray(route.query.section) ? route.query.section[0] : route.query.section;
  if (raw && raw !== section) selectSection(section);
}, { immediate: true });
</script>

<style scoped>
.admin-center { min-height: 100vh; padding: 28px; color: hsl(var(--foreground)); background: hsl(var(--background)); }
.admin-center-header { max-width: 1500px; margin: 0 auto 22px; display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
.admin-center-eyebrow { margin: 0 0 5px; color: hsl(var(--primary)); font-size: 12px; font-weight: 700; letter-spacing: .12em; }
.admin-center-header h1 { margin: 0; font-size: clamp(24px, 3vw, 34px); }
.admin-center-header p:not(.admin-center-eyebrow) { margin: 8px 0 0; color: hsl(var(--muted-foreground)); }
.admin-center-back { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid hsl(var(--border)); border-radius: 10px; color: inherit; text-decoration: none; }
.admin-center-layout { max-width: 1500px; min-height: calc(100vh - 140px); margin: 0 auto; display: grid; grid-template-columns: 230px minmax(0, 1fr); border: 1px solid hsl(var(--border)); border-radius: 16px; overflow: hidden; background: hsl(var(--card)); }
.admin-center-navigation { padding: 18px 12px; border-right: 1px solid hsl(var(--border)); background: hsl(var(--muted) / .28); }
.admin-nav-group + .admin-nav-group { margin-top: 22px; }
.admin-nav-group h2 { margin: 0 10px 7px; color: hsl(var(--muted-foreground)); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
.admin-nav-item { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 0; border-radius: 9px; color: hsl(var(--muted-foreground)); background: transparent; text-align: left; cursor: pointer; }
.admin-nav-item:hover, .admin-nav-item:focus-visible { color: hsl(var(--foreground)); background: hsl(var(--accent)); outline: none; }
.admin-nav-item.active { color: hsl(var(--primary-foreground)); background: hsl(var(--primary)); }
.admin-center-content { min-width: 0; padding: 24px; overflow: auto; }
.admin-section-header { padding-bottom: 18px; margin-bottom: 20px; border-bottom: 1px solid hsl(var(--border)); }
.admin-section-header h2 { margin: 0; font-size: 22px; }
.admin-section-header p { margin: 6px 0 0; color: hsl(var(--muted-foreground)); }
.admin-overview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.admin-overview-card { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 20px; border: 1px solid hsl(var(--border)); border-radius: 12px; color: inherit; background: hsl(var(--background)); text-align: left; cursor: pointer; }
.admin-overview-card:hover, .admin-overview-card:focus-visible { border-color: hsl(var(--primary)); box-shadow: 0 8px 24px hsl(var(--foreground) / .07); outline: none; }
.admin-overview-card > i:first-child { font-size: 22px; color: hsl(var(--primary)); }
.admin-overview-card span { display: grid; gap: 5px; }
.admin-overview-card small { color: hsl(var(--muted-foreground)); line-height: 1.45; }
@media (max-width: 760px) {
  .admin-center { padding: 12px; }
  .admin-center-header { align-items: stretch; flex-direction: column; }
  .admin-center-back { align-self: flex-start; }
  .admin-center-layout { display: block; }
  .admin-center-navigation { display: flex; gap: 8px; overflow-x: auto; border-right: 0; border-bottom: 1px solid hsl(var(--border)); }
  .admin-nav-group { display: contents; }
  .admin-nav-group h2 { display: none; }
  .admin-nav-item { width: auto; white-space: nowrap; }
  .admin-center-content { padding: 16px; }
  .admin-overview-grid { grid-template-columns: 1fr; }
}
</style>

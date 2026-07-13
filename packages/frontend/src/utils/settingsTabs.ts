export type SettingsTabKey =
  | 'dashboard'
  | 'system'
  | 'security'
  | 'appearance'
  | 'ipControl'
  | 'workspace'
  | 'ai'
  | 'notifications'
  | 'proxies'
  | 'dataManagement'
  | 'auditLogs'
  | 'sessionRecordings'
  | 'accessControl'
  | 'about';

export interface SettingsTab {
  key: SettingsTabKey;
  label: string;
  icon: string;
}

type TranslateFn = (key: string, fallback?: string) => string;

export const createSettingsTabs = (t: TranslateFn): SettingsTab[] => [
  { key: 'dashboard', label: t('nav.dashboard', '仪表盘'), icon: 'fas fa-chart-line' },
  { key: 'system', label: t('settings.tabs.system', '系统'), icon: 'fas fa-sliders' },
  { key: 'security', label: t('settings.tabs.security', '安全'), icon: 'fas fa-shield-halved' },
  { key: 'appearance', label: t('settings.tabs.appearance', '外观'), icon: 'fas fa-palette' },
  { key: 'ipControl', label: t('settings.tabs.ipControl', 'IP 管控'), icon: 'fas fa-network-wired' },
  { key: 'workspace', label: t('settings.tabs.workspace', '工作区'), icon: 'fas fa-table-columns' },
  { key: 'ai', label: t('settings.tabs.ai', 'AI 助手'), icon: 'fas fa-wand-magic-sparkles' },
  { key: 'notifications', label: t('settings.tabs.notifications', '通知管理'), icon: 'fas fa-bell' },
  { key: 'proxies', label: t('settings.tabs.proxies', '代理管理'), icon: 'fas fa-route' },
  { key: 'dataManagement', label: t('settings.tabs.dataManagement', '数据管理'), icon: 'fas fa-database' },
  { key: 'auditLogs', label: t('nav.auditLogs', '审计日志'), icon: 'fas fa-shield-halved' },
  { key: 'sessionRecordings', label: t('sessionRecording.title', '会话录像'), icon: 'fas fa-video' },
  { key: 'accessControl', label: t('accessControl.title', '访问控制'), icon: 'fas fa-users-gear' },
  { key: 'about', label: t('settings.tabs.about', '关于'), icon: 'fas fa-circle-info' },
];

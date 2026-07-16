import { AuthorizationSubject } from '../access-control/authorization-subject';

export const PERSONAL_SETTING_KEYS = new Set([
  'language', 'focusSwitcherSequence', 'navBarVisible', 'layoutTree', 'autoCopyOnSelect',
  'sidebarConfig', 'showConnectionTags', 'showQuickCommandTags', 'showStatusMonitorIpAddress',
  'showPopupFileEditor', 'showPopupFileManager', 'shareFileEditorTabs', 'workspaceSidebarPersistent',
  'sidebarPaneWidths', 'fileManagerRowSizeMultiplier', 'fileManagerColWidths',
  'fileManagerShowDeleteConfirmation', 'commandInputSyncTarget', 'timezone', 'layoutLocked',
  'rdpModalWidth', 'rdpModalHeight', 'vncModalWidth', 'vncModalHeight',
  'rdpDefaultFixedResolution', 'rdpDefaultWidth', 'rdpDefaultHeight', 'rdpDefaultQuality',
  'vncDefaultFixedResolution', 'vncDefaultWidth', 'vncDefaultHeight', 'vncDefaultQuality',
  'dockerDefaultExpand', 'terminalScrollbackLimit', 'terminalEnableRightClickPaste',
  'terminalPerformanceMode', 'terminalHighlightEnabled', 'terminalHighlightRules',
]);

export const SYSTEM_MUTABLE_SETTING_KEYS = new Set([
  'ipWhitelist', 'ipWhitelistEnabled', 'ipBlacklistEnabled', 'maxLoginAttempts',
  'loginBanDuration', 'dockerManagerEnabled', 'dockerStatusIntervalSeconds',
  'statusMonitorEnabled', 'statusMonitorIntervalSeconds', 'sessionRecordingEnabled',
]);

export const SAFE_GLOBAL_SETTING_KEYS = new Set([
  'dockerManagerEnabled', 'dockerStatusIntervalSeconds', 'statusMonitorEnabled',
  'statusMonitorIntervalSeconds', 'ipBlacklistEnabled',
]);

export const SENSITIVE_GLOBAL_SETTING_KEYS = new Set([
  'captchaConfig', 'aiProviderConfig', 'smtpPass', 'smtpPassword', 'smtpToken',
]);

export const isSystemAdministrator = (subject: AuthorizationSubject): boolean => (
  subject.runtime === 'desktop'
  || subject.systemRole === 'super_admin'
  || subject.systemRole === 'admin'
);

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSettingsTabs } from '../src/utils/settingsTabs';

const appVue = readFileSync(resolve('src/App.vue'), 'utf8');
const routerIndex = readFileSync(resolve('src/router/index.ts'), 'utf8');
const connectionsView = readFileSync(resolve('src/views/ConnectionsView.vue'), 'utf8');
const settingsView = readFileSync(resolve('src/views/SettingsView.vue'), 'utf8');
const dataManagementSection = readFileSync(resolve('src/components/settings/DataManagementSection.vue'), 'utf8');
const dataManagementComposable = readFileSync(resolve('src/composables/settings/useDataManagement.ts'), 'utf8');
const terminalVue = readFileSync(resolve('src/components/Terminal.vue'), 'utf8');
const terminalTabBar = readFileSync(resolve('src/components/TerminalTabBar.vue'), 'utf8');
const workspaceView = readFileSync(resolve('src/views/WorkspaceView.vue'), 'utf8');
const quickCommandsView = readFileSync(resolve('src/views/QuickCommandsView.vue'), 'utf8');
const addEditQuickCommandForm = readFileSync(resolve('src/components/AddEditQuickCommandForm.vue'), 'utf8');
const quickCommandsModal = readFileSync(resolve('src/components/QuickCommandsModal.vue'), 'utf8');
const focusSwitcherConfigurator = readFileSync(resolve('src/components/FocusSwitcherConfigurator.vue'), 'utf8');
const draggableDialogComposable = readFileSync(resolve('src/composables/useDraggableDialog.ts'), 'utf8');

const tabKeys = createSettingsTabs((key, fallback) => fallback || key).map(tab => tab.key);

assert.equal(tabKeys.includes('dashboard'), false, 'dashboard should not appear in settings');
assert.equal(settingsView.includes('DashboardView'), false, 'settings should not load dashboard content');
assert.equal(
  settingsView.includes("activeTab === 'dashboard'"),
  false,
  'settings should not retain a dashboard rendering branch',
);

assert.equal(tabKeys.includes('dataManagement'), false, 'data management should live in the admin center');
assert.equal(tabKeys.includes('auditLogs'), false, 'audit logs should live in the admin center');

assert.equal(
  appVue.includes('class="app-dock"') || appVue.includes("'app-dock'"),
  false,
  'App.vue should not render the left dock container',
);

assert.equal(
  appVue.includes('dock-hover-bar'),
  false,
  'App.vue should not render the dock hover affordance',
);

assert.equal(
  connectionsView.includes('server-bottom-actions'),
  true,
  'ConnectionsView should host the relocated theme and action controls at the lower left',
);

assert.match(
  routerIndex,
  /path:\s*'\/'[\s\S]*name:\s*'Connections'[\s\S]*component:\s*\(\)\s*=>\s*import\('\.\.\/views\/ConnectionsView\.vue'\)/,
  'the home path should directly render the server page without changing the URL',
);

assert.match(
  routerIndex,
  /path:\s*'\/connections'[\s\S]*redirect:\s*\{\s*name:\s*'Connections'\s*\}/,
  'the legacy /connections path should redirect to the home server route',
);

const bottomActionsIndex = connectionsView.indexOf('class="server-bottom-actions"');
assert.notEqual(bottomActionsIndex, -1, 'server bottom actions markup should be present');
const actionButtonIndex = connectionsView.indexOf('serverActionButtonRef', bottomActionsIndex);
const themeButtonIndex = connectionsView.indexOf('themeToggleLabel', bottomActionsIndex);
assert.notEqual(actionButtonIndex, -1, 'server bottom actions should contain the action menu button');
assert.notEqual(themeButtonIndex, -1, 'server bottom actions should contain the theme toggle button');
assert.ok(
  actionButtonIndex < themeButtonIndex,
  'the action menu button should be to the left of the theme toggle button',
);

assert.equal(
  connectionsView.includes('@mouseenter="openServerActionMenu"'),
  true,
  'hovering the server action menu should open its popup options',
);

assert.equal(
  connectionsView.includes('@focusin="openServerActionMenu"'),
  true,
  'keyboard focus on the server action menu should also open its popup options',
);

assert.equal(
  connectionsView.includes('@mouseleave="scheduleServerActionMenuClose"'),
  true,
  'leaving the server action menu should schedule a delayed close',
);

assert.match(
  connectionsView,
  /const\s+SERVER_ACTION_MENU_CLOSE_DELAY_MS\s*=\s*\d+/,
  'the server action menu should use a close delay so the popup remains selectable',
);

assert.match(
  connectionsView,
  /clearServerActionMenuCloseTimer\(\);[\s\S]*isServerActionMenuOpen\.value\s*=\s*true/,
  're-entering the server action menu should cancel a pending close',
);

assert.match(
  connectionsView,
  /const\s+SERVER_PANEL_DEFAULT_WIDTH\s*=\s*SERVER_PANEL_MIN_WIDTH/,
  'the server list should default to the minimum width',
);

assert.match(
  connectionsView,
  /\.server-list-panel\s*\{[\s\S]*overflow:\s*hidden;/,
  'the server list panel should not show a horizontal scrollbar at the bottom',
);

assert.equal(
  connectionsView.includes('server-panel-mobile-collapse-button'),
  false,
  'the mobile server panel should not add a dedicated collapse button',
);

assert.match(
  connectionsView,
  /@media \(max-width: 900px\)\s*\{[\s\S]*\.server-list-panel\.is-collapsed\s*\{[\s\S]*width:\s*0\s*!important;[\s\S]*min-width:\s*0\s*!important;[\s\S]*border-right-width:\s*0;/,
  'the collapsed mobile server panel should be fully hidden without reserving edge space',
);

assert.ok(
  connectionsView.includes('class="server-panel-mobile-dismiss-overlay"')
    && connectionsView.includes('@click="collapseServerPanel"')
    && connectionsView.includes('v-if="!isServerPanelCollapsed"'),
  'the expanded mobile server panel should provide a right-side overlay that collapses it when clicked',
);

assert.match(
  connectionsView,
  /\.server-panel-mobile-dismiss-overlay\s*\{[\s\S]*display:\s*none;/,
  'the server panel dismiss overlay should be hidden outside mobile layouts',
);

assert.match(
  connectionsView,
  /@media \(max-width: 900px\)\s*\{[\s\S]*\.server-panel-mobile-dismiss-overlay\s*\{[\s\S]*display:\s*block;[\s\S]*z-index:\s*11;/,
  'the mobile server panel dismiss overlay should sit below the expanded panel and above workspace content',
);

assert.ok(
  connectionsView.includes('<teleport to="body">') && connectionsView.includes(':style="tagFilterMenuStyle"'),
  'the tag filter popup should be rendered outside the clipped server panel',
);

assert.ok(
  /class="[^"]*\bterminal-tabs-scroll\b/.test(terminalTabBar)
    && terminalTabBar.includes('.terminal-tabs-scroll::-webkit-scrollbar'),
  'the terminal tab scroller should hide its scrollbar while preserving horizontal scrolling',
);

assert.match(
  terminalVue,
  /\.terminal-inner-container\s+:deep\(\.xterm-viewport\)\s*\{[\s\S]*scrollbar-width:\s*none;[\s\S]*-ms-overflow-style:\s*none;/,
  'the terminal content viewport should hide its scrollbar while preserving terminal scrollback',
);

assert.match(
  terminalVue,
  /\.terminal-inner-container\s+:deep\(\.xterm-viewport\)::-webkit-scrollbar\s*\{[\s\S]*width:\s*0;[\s\S]*height:\s*0;/,
  'the terminal content viewport should hide WebKit scrollbars',
);

assert.match(
  terminalTabBar,
  /const\s+isConnectionsPagePath\s*=\s*\(path:\s*string\)\s*=>\s*\(\s*path\s*===\s*'\/'\s*\|\|\s*path\s*===\s*'\/connections'\s*\)/,
  'the terminal tab bar should treat the home route as the server page',
);

assert.ok(
  workspaceView.includes('class="file-manager-modal-root')
    && workspaceView.includes('class="file-manager-modal-content'),
  'the file manager modal should use dedicated shell classes for responsive sizing',
);

assert.match(
  workspaceView,
  /@media \(max-width:\s*768px\)\s*\{[\s\S]*\.file-manager-modal-root\s*\{[\s\S]*padding:\s*0\.5rem;[\s\S]*\.file-manager-modal-content\s*\{[\s\S]*width:\s*min\(100%,\s*calc\(100vw - 1rem\)\);[\s\S]*max-width:\s*calc\(100vw - 1rem\);[\s\S]*\.file-manager-modal-body\s*\{[\s\S]*overflow-x:\s*auto;/,
  'the mobile file manager modal should stay within the viewport and scroll wide content internally',
);

assert.match(
  routerIndex,
  /path:\s*'\/settings'[\s\S]*redirect:\s*\{\s*name:\s*'Connections'[\s\S]*query:\s*\{\s*settings:\s*'1'\s*\}/,
  'settings path should redirect to a query overlay on the home server route so the server page instance stays mounted',
);

assert.ok(
  appVue.includes('<SettingsView')
    && appVue.includes('isSettingsOverlayVisible')
    && appVue.includes('closeSettingsOverlay'),
  'App.vue should host the settings dialog as a top-level overlay while preserving the server page instance',
);

assert.ok(
  dataManagementSection.includes('settings.importConnections.title')
    && dataManagementSection.includes('@submit.prevent="submitImportConnections"')
    && dataManagementSection.includes('accept=".zip,application/zip,application/x-zip-compressed"'),
  'data management should provide an encrypted ZIP import form',
);

assert.ok(
  dataManagementComposable.includes("apiClient.post<ImportConnectionsResult>('/settings/import-connections'")
    && dataManagementComposable.includes("formData.append('connectionsZip', file)")
    && dataManagementComposable.includes('connectionsStore.fetchConnections()'),
  'data management import should upload the ZIP and refresh imported data',
);

assert.ok(
  quickCommandsView.includes('<Teleport :to="quickCommandTeleportTarget">')
    && quickCommandsView.includes('ownerDocument.body')
    && quickCommandsView.includes('<AddEditQuickCommandForm')
    && quickCommandsView.includes('</Teleport>'),
  'quick command add/edit form should teleport to body so it is not clipped by the sidebar or quick command popup',
);

assert.ok(
  addEditQuickCommandForm.includes('quick-command-form-close')
    && addEditQuickCommandForm.includes('@click="closeForm"')
    && addEditQuickCommandForm.includes('fa-xmark'),
  'quick command add/edit modal should include a top-right close button',
);

assert.match(
  appVue,
  /router\.push\(\{\s*name:\s*'Connections'\s*\}\)/,
  'closing the settings overlay should return to the home server route',
);

assert.ok(
  settingsView.includes("from '../composables/useResizable'")
    && settingsView.includes('useResizable(dialogShellRef')
    && settingsView.includes('settings-resize-hint'),
  'settings dialog should be resizable from its border',
);

assert.ok(
  quickCommandsModal.includes("from '../composables/useResizable'")
    && quickCommandsModal.includes('useResizable(modalContentRef')
    && quickCommandsModal.includes('quick-command-modal-resize-hint'),
  'quick commands modal should be resizable from its border',
);

assert.ok(
  focusSwitcherConfigurator.includes("from '../composables/useResizable'")
    && focusSwitcherConfigurator.includes('useResizable(dialogRef')
    && focusSwitcherConfigurator.includes('focus-switcher-resize-hint'),
  'focus switcher configurator should be resizable from its border',
);

assert.ok(
  draggableDialogComposable.includes("from './useResizable'")
    && draggableDialogComposable.includes('resizable?: boolean | UseResizableOptions')
    && draggableDialogComposable.includes('options.resizable !== false'),
  'common draggable dialogs should support border resizing by default',
);

assert.ok(
  addEditQuickCommandForm.includes('resizable: false')
    && quickCommandsModal.includes('resizable: false')
    && focusSwitcherConfigurator.includes('resizable: false'),
  'dialogs with explicit resize handling should disable the draggable default resize listener',
);

console.log('navigation relocation behavior ok');

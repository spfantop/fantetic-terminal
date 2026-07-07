import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSettingsTabs } from '../src/utils/settingsTabs';

const appVue = readFileSync(resolve('src/App.vue'), 'utf8');
const routerIndex = readFileSync(resolve('src/router/index.ts'), 'utf8');
const connectionsView = readFileSync(resolve('src/views/ConnectionsView.vue'), 'utf8');
const settingsView = readFileSync(resolve('src/views/SettingsView.vue'), 'utf8');
const settingsOverlayView = readFileSync(resolve('src/views/SettingsOverlayView.vue'), 'utf8');
const dataManagementSection = readFileSync(resolve('src/components/settings/DataManagementSection.vue'), 'utf8');
const dataManagementComposable = readFileSync(resolve('src/composables/settings/useDataManagement.ts'), 'utf8');
const terminalVue = readFileSync(resolve('src/components/Terminal.vue'), 'utf8');
const terminalTabBar = readFileSync(resolve('src/components/TerminalTabBar.vue'), 'utf8');

const tabKeys = createSettingsTabs((key, fallback) => fallback || key).map(tab => tab.key);

assert.deepEqual(
  tabKeys.slice(0, 2),
  ['dashboard', 'system'],
  'dashboard should be the first settings tab',
);

assert.equal(
  tabKeys[tabKeys.indexOf('dataManagement') + 1],
  'auditLogs',
  'audit logs should appear directly below data management in settings',
);

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

assert.match(
  routerIndex,
  /path:\s*'\/settings'[\s\S]*component:\s*\(\)\s*=>\s*import\('\.\.\/views\/SettingsOverlayView\.vue'\)/,
  'settings should render as an overlay on top of the server page',
);

assert.ok(
  settingsOverlayView.includes('<ConnectionsView />') && settingsOverlayView.includes('<SettingsView is-dialog'),
  'settings overlay should show the server page behind the settings dialog',
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

assert.match(
  settingsOverlayView,
  /router\.push\(\{\s*name:\s*'Connections'\s*\}\)/,
  'closing the settings overlay should return to the home server route',
);

console.log('navigation relocation behavior ok');

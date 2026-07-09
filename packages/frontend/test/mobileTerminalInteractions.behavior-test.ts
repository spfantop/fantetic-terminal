import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const commandInputBar = fs.readFileSync(path.resolve('src/components/CommandInputBar.vue'), 'utf8');
const quickCommandsModal = fs.readFileSync(path.resolve('src/components/QuickCommandsModal.vue'), 'utf8');
const suspendedSshSessionsModal = fs.readFileSync(path.resolve('src/components/SuspendedSshSessionsModal.vue'), 'utf8');
const workspaceConnectionList = fs.readFileSync(path.resolve('src/components/WorkspaceConnectionList.vue'), 'utf8');
const terminalTabBar = fs.readFileSync(path.resolve('src/components/TerminalTabBar.vue'), 'utf8');
const connectionsView = fs.readFileSync(path.resolve('src/views/ConnectionsView.vue'), 'utf8');
const workspaceView = fs.readFileSync(path.resolve('src/views/WorkspaceView.vue'), 'utf8');
const settingsView = fs.readFileSync(path.resolve('src/views/SettingsView.vue'), 'utf8');
const fileManager = fs.readFileSync(path.resolve('src/components/FileManager.vue'), 'utf8');
const layoutRenderer = fs.readFileSync(path.resolve('src/components/LayoutRenderer.vue'), 'utf8');
const virtualKeyboard = fs.readFileSync(path.resolve('src/components/VirtualKeyboard.vue'), 'utf8');
const addEditQuickCommandForm = fs.readFileSync(path.resolve('src/components/AddEditQuickCommandForm.vue'), 'utf8');
const mobileLongPress = fs.readFileSync(path.resolve('src/composables/useMobileLongPress.ts'), 'utf8');

assert.match(
  quickCommandsModal,
  /const isMobileViewport = computed/,
  'quick commands modal should detect mobile viewport',
);

assert.match(
  quickCommandsModal,
  /calc\(100dvw - 2rem\)/,
  'quick commands modal should keep comfortable mobile side gutters',
);

assert.match(
  suspendedSshSessionsModal,
  /calc\(100dvw - 2rem\)/,
  'suspended SSH modal should keep comfortable mobile side gutters',
);

assert.match(
  commandInputBar,
  /<QuickCommandsModal[\s\S]*:is-mobile="props\.isMobile"/,
  'command bar should pass mobile state to quick commands modal',
);

assert.match(
  commandInputBar,
  /<SuspendedSshSessionsModal[\s\S]*:is-mobile="props\.isMobile"/,
  'command bar should pass mobile state to suspended SSH modal',
);

assert.match(
  terminalTabBar,
  /<SuspendedSshSessionsModal[\s\S]*:is-mobile="props\.isMobile"/,
  'terminal tab bar should pass mobile state to suspended SSH modal',
);

assert.match(
  mobileLongPress,
  /export function createMobileLongPressHandlers/,
  'mobile long press helper should be reusable',
);

assert.match(
  mobileLongPress,
  /isMobile\(\)/,
  'mobile long press helper should gate itself to mobile mode',
);

assert.match(
  workspaceConnectionList,
  /createMobileLongPressHandlers/,
  'workspace connection list should support mobile long press menus',
);

assert.match(
  connectionsView,
  /createMobileLongPressHandlers/,
  'connections page server list should support mobile long press menus',
);

assert.match(
  fileManager,
  /createMobileLongPressHandlers/,
  'file manager should support mobile long press menus',
);

assert.match(
  layoutRenderer,
  /useDeviceDetection/,
  'layout renderer should know whether it is rendering mobile layout panes',
);

assert.match(
  layoutRenderer,
  /isMobile:\s*isMobile\.value/,
  'layout renderer should pass mobile state into reusable panes',
);

assert.match(
  workspaceView,
  /mobile-content-area[\s\S]*mobile-virtual-keyboard/s,
  'workspace mobile layout should keep terminal and virtual keyboard in the same flex column',
);

assert.match(
  workspaceView,
  /--mobile-virtual-keyboard-height/,
  'workspace mobile layout should reserve a stable keyboard height for terminal resize',
);

assert.match(
  virtualKeyboard,
  /const keyRows: KeyRow\[\]/,
  'virtual keyboard should define rows instead of one long wrapped key list',
);

assert.match(
  virtualKeyboard,
  /mode:\s*'letters'/,
  'virtual keyboard should support a letters mode',
);

assert.match(
  virtualKeyboard,
  /mode:\s*'symbols'/,
  'virtual keyboard should support a symbols mode for SSH punctuation',
);

assert.match(
  virtualKeyboard,
  /Space[\s\S]*sequence:\s*' '/,
  'virtual keyboard should include a real space key',
);

assert.match(
  virtualKeyboard,
  /Enter[\s\S]*sequence:\s*'\\r'/,
  'virtual keyboard should send carriage return for Enter',
);

assert.match(
  virtualKeyboard,
  /Backspace[\s\S]*sequence:\s*'\\x7f'/,
  'virtual keyboard should send DEL for Backspace in SSH terminals',
);

assert.match(
  virtualKeyboard,
  /Ctrl\+C[\s\S]*sequence:\s*'\\x03'/,
  'virtual keyboard should expose common SSH control keys directly',
);

assert.match(
  virtualKeyboard,
  /const modeRows = computed/,
  'virtual keyboard should swap only mode rows when Sym is clicked',
);

assert.match(
  virtualKeyboard,
  /\.virtual-keyboard-mode-panel/,
  'virtual keyboard should keep a stable mode panel height',
);

assert.match(
  addEditQuickCommandForm,
  /quick-command-form-mobile/,
  'quick command add/edit dialog should have a mobile-specific layout',
);

assert.match(
  addEditQuickCommandForm,
  /calc\(100dvw - 2rem\)/,
  'quick command add/edit dialog should keep comfortable mobile side gutters',
);

assert.match(
  settingsView,
  /isMobileViewport/,
  'settings dialog should detect mobile viewport',
);

assert.match(
  settingsView,
  /calc\(100dvw - 2rem\)/,
  'settings dialog should keep comfortable mobile side gutters',
);

console.log('mobile terminal interactions behavior ok');

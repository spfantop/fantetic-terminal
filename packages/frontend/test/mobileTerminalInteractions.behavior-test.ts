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
const fileManagerContextMenu = fs.readFileSync(path.resolve('src/composables/file-manager/useFileManagerContextMenu.ts'), 'utf8');
const layoutRenderer = fs.readFileSync(path.resolve('src/components/LayoutRenderer.vue'), 'utf8');
const virtualKeyboard = fs.readFileSync(path.resolve('src/components/VirtualKeyboard.vue'), 'utf8');
const addConnectionForm = fs.readFileSync(path.resolve('src/components/AddConnectionForm.vue'), 'utf8');
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
  terminalTabBar,
  /const isConnectionListPopupMobileViewport = computed/,
  'terminal tab new connection popup should detect mobile viewport',
);

assert.match(
  terminalTabBar,
  /const connectionListPopupContentStyle = computed/,
  'terminal tab new connection popup should apply responsive content sizing',
);

assert.match(
  terminalTabBar,
  /calc\(100dvw - 2rem\)/,
  'terminal tab new connection popup should keep comfortable mobile side gutters',
);

assert.match(
  terminalTabBar,
  /disabled:\s*isConnectionListPopupMobileViewport/,
  'terminal tab new connection popup should not keep draggable absolute positioning on mobile',
);

assert.match(
  terminalTabBar,
  /if \(!isConnectionListPopupMobileViewport\.value\) \{\s*centerConnectionListPopup\(\);/s,
  'terminal tab new connection popup should not write absolute center positioning on mobile',
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
  fileManagerContextMenu,
  /suppressNextContextMenuClose/,
  'file manager context menu should ignore the synthetic click after mobile long press',
);

assert.match(
  connectionsView,
  /serverListBodyLongPressHandlers/,
  'connections page server list empty area should support mobile long press menus',
);

assert.match(
  connectionsView,
  /const scheduleServerActionMenuClose = \(\) => \{\s*if \(isMobile\.value\) return;/s,
  'mobile server action menu should not be closed by synthetic hover leave events',
);

assert.match(
  connectionsView,
  /v-if="!isServerPanelCollapsed && !isServerActionMenuOpen"/,
  'mobile server panel dismiss overlay should not stay active while the action menu is open',
);

assert.match(
  connectionsView,
  /class="server-actions-menu"[\s\S]*@pointerdown\.stop/,
  'mobile server action menu should stop pointer events from leaking to surrounding mobile dismiss handlers',
);

assert.match(
  connectionsView,
  /@touchstart="serverListBodyLongPressHandlers\.onTouchstart"/,
  'connections page server list body should bind mobile long press touchstart',
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
  /label:\s*'空格'[\s\S]*sequence:\s*' '/,
  'virtual keyboard should include the reference-style Chinese space key',
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

assert.doesNotMatch(
  virtualKeyboard,
  /label:\s*'Ctrl\+C'/,
  'virtual keyboard should match the reference by using a Ctrl lock key instead of a separate Ctrl+C key',
);

assert.match(
  virtualKeyboard,
  /controlSequenceFor[\s\S]*charCodeAt\(0\) - 'A'\.charCodeAt\(0\) \+ 1/,
  'virtual keyboard should still send Ctrl+C by locking Ctrl and tapping c',
);

assert.match(
  virtualKeyboard,
  /const modeRows = computed/,
  'virtual keyboard should swap only mode rows when Sym is clicked',
);

assert.match(
  virtualKeyboard,
  /const modeTabs: KeyDefinition\[\]/,
  'virtual keyboard should render a fixed segmented mode switcher',
);

assert.match(
  virtualKeyboard,
  /label:\s*'字母'[\s\S]*label:\s*'符号'[\s\S]*label:\s*'命令'/,
  'virtual keyboard mode tabs should use the same Chinese labels as the reference',
);

assert.match(
  virtualKeyboard,
  /id:\s*'quick-actions'[\s\S]*label:\s*'Esc'[\s\S]*label:\s*'Tab'[\s\S]*label:\s*'Ctrl'[\s\S]*label:\s*'Alt'[\s\S]*label:\s*'↑'[\s\S]*label:\s*'↓'[\s\S]*label:\s*'←'[\s\S]*label:\s*'→'[\s\S]*label:\s*'Paste'[\s\S]*label:\s*'Enter'/,
  'virtual keyboard fixed control row should mirror the reference order',
);

assert.match(
  virtualKeyboard,
  /label:\s*'Paste'[\s\S]*type:\s*'paste'/,
  'virtual keyboard should include a fixed Paste key like the terminal keyboard reference',
);

assert.match(
  virtualKeyboard,
  /const isShiftActive = ref\(false\)/,
  'virtual keyboard should support a shift state for normal keyboard input',
);

assert.match(
  virtualKeyboard,
  /type:\s*'command-template'/,
  'virtual keyboard command mode should select reusable command templates',
);

assert.match(
  virtualKeyboard,
  /commandAction:\s*'execute'/,
  'virtual keyboard command mode should support executing the selected command',
);

assert.match(
  virtualKeyboard,
  /docker logs -f[\s\S]*systemctl status/,
  'virtual keyboard command mode should include common SSH command templates',
);

assert.match(
  virtualKeyboard,
  /label:\s*'全角'[\s\S]*type:\s*'noop'/,
  'virtual keyboard symbol mode should include the reference full-width toggle placeholder',
);

assert.match(
  virtualKeyboard,
  /type:\s*'hide'/,
  'virtual keyboard should include the reference-style hide keyboard key',
);

assert.match(
  workspaceView,
  /@hide="isVirtualKeyboardVisible = false"/,
  'workspace mobile virtual keyboard should be hideable from the reference-style down key',
);

assert.match(
  virtualKeyboard,
  /class="virtual-keyboard-mode-tabs"/,
  'virtual keyboard should show mode tabs as a dedicated segmented control',
);

assert.match(
  virtualKeyboard,
  /class="virtual-keyboard-command-actions"/,
  'virtual keyboard command mode should expose insert and execute actions',
);

assert.match(
  virtualKeyboard,
  /linear-gradient\(180deg[\s\S]*box-shadow:\s*inset/,
  'virtual keyboard should use the darker raised key visual style from the reference',
);

assert.match(
  virtualKeyboard,
  /\.virtual-keyboard-mode-panel/,
  'virtual keyboard should keep a stable mode panel height',
);

assert.match(
  virtualKeyboard,
  /id:\s*'quick-actions'/,
  'virtual keyboard should include a compact SSH quick action row',
);

assert.match(
  virtualKeyboard,
  /label:\s*'命令'/,
  'virtual keyboard should provide the reference command mode tab',
);

assert.match(
  addConnectionForm,
  /connection-form-mobile/,
  'add/edit connection dialog should have mobile-specific layout',
);

assert.match(
  addConnectionForm,
  /calc\(100dvw - 2rem\)/,
  'add/edit connection dialog should keep comfortable mobile side gutters',
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

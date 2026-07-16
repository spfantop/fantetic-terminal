import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workspaceView = fs.readFileSync(path.resolve('src/views/WorkspaceView.vue'), 'utf8');
const fileEditorOverlay = fs.readFileSync(path.resolve('src/components/FileEditorOverlay.vue'), 'utf8');
const fileManagerActionModal = fs.readFileSync(path.resolve('src/components/FileManagerActionModal.vue'), 'utf8');
const favoritePathsModal = fs.readFileSync(path.resolve('src/components/FavoritePathsModal.vue'), 'utf8');
const draggableDialog = fs.readFileSync(path.resolve('src/composables/useDraggableDialog.ts'), 'utf8');
const resizable = fs.readFileSync(path.resolve('src/composables/useResizable.ts'), 'utf8');
const fileEditorContainer = fs.readFileSync(path.resolve('src/components/FileEditorContainer.vue'), 'utf8');
const fileEditorTabs = fs.readFileSync(path.resolve('src/components/FileEditorTabs.vue'), 'utf8');
const quickCommandsView = fs.readFileSync(path.resolve('src/views/QuickCommandsView.vue'), 'utf8');
const commandHistoryView = fs.readFileSync(path.resolve('src/views/CommandHistoryView.vue'), 'utf8');
const workspaceConnectionList = fs.readFileSync(path.resolve('src/components/WorkspaceConnectionList.vue'), 'utf8');
const fileManager = fs.readFileSync(path.resolve('src/components/FileManager.vue'), 'utf8');
const commandInputBar = fs.readFileSync(path.resolve('src/components/CommandInputBar.vue'), 'utf8');
const quickCommandsModal = fs.readFileSync(path.resolve('src/components/QuickCommandsModal.vue'), 'utf8');
const suspendedSshSessionsModal = fs.readFileSync(path.resolve('src/components/SuspendedSshSessionsModal.vue'), 'utf8');
const focusSwitcherConfigurator = fs.readFileSync(path.resolve('src/components/FocusSwitcherConfigurator.vue'), 'utf8');
const aiAssistantPanel = fs.readFileSync(path.resolve('src/components/AIAssistantPanel.vue'), 'utf8');
const statusMonitor = fs.readFileSync(path.resolve('src/components/StatusMonitor.vue'), 'utf8');
const remoteDesktopSession = fs.readFileSync(path.resolve('src/components/RemoteDesktopSession.vue'), 'utf8');
const remoteDesktopModal = fs.readFileSync(path.resolve('src/components/RemoteDesktopModal.vue'), 'utf8');
const vncModal = fs.readFileSync(path.resolve('src/components/VncModal.vue'), 'utf8');
const workspaceEvents = fs.readFileSync(path.resolve('src/composables/workspaceEvents.ts'), 'utf8');
const focusSwitcherStore = fs.readFileSync(path.resolve('src/stores/focusSwitcher.store.ts'), 'utf8');

assert.match(
  workspaceView,
  /import FileEditorOverlay from '\.\.\/components\/FileEditorOverlay\.vue'/,
  'pop-out workspace should import the file editor overlay',
);

assert.match(
  workspaceView,
  /h\(FileEditorOverlay,[\s\S]*sessionId:\s*sessionId/,
  'pop-out workspace should mount a session-scoped file editor overlay',
);

assert.match(
  workspaceView,
  /h\(UINotificationDisplay\)/,
  'pop-out workspace should render notifications inside the pop-out document',
);

assert.match(
  workspaceView,
  /h\(ConfirmDialog,[\s\S]*dialogStore\.state/,
  'pop-out workspace should render confirmation dialogs inside the pop-out document',
);

assert.match(
  workspaceView,
  /h\(FocusSwitcherConfigurator,[\s\S]*focusSwitcherStore\.isConfiguratorVisible[\s\S]*teleportTarget:\s*popup\.document\.body/,
  'pop-out workspace should render the focus switcher configurator inside the pop-out document',
);

assert.match(
  workspaceView,
  /h\(PopoutFileManagerModal,[\s\S]*ownerDocument:\s*popup\.document/,
  'pop-out workspace should render command-bar file manager popups inside the pop-out document',
);

assert.match(
  workspaceView,
  /registerPopoutFocusSwitcherHotkeys\(popup,[\s\S]*sessionId[\s\S]*\)/,
  'pop-out workspace should register Alt focus-switcher hotkeys on the pop-out window',
);

assert.match(
  workspaceView,
  /state\.windowRef\.removeEventListener\('keydown', state\.focusSwitcherKeyDownHandler,[\s\S]*state\.windowRef\.removeEventListener\('keyup', state\.focusSwitcherKeyUpHandler,/,
  'pop-out workspace should remove pop-out Alt hotkey listeners when closing',
);

assert.match(
  workspaceEvents,
  /'fileManager:openModalRequest':\s*\{\s*sessionId:\s*string;\s*sourceDocument\?:\s*Document\s*\}/,
  'file manager open requests should carry their source document for pop-out scoping',
);

assert.match(
  workspaceView,
  /if\s*\(payload\.sourceDocument && payload\.sourceDocument !== ownerDocument\)\s*return;/,
  'workspace file manager modal should ignore requests from another document',
);

assert.match(
  commandInputBar,
  /readCommandBarDocument[\s\S]*commandBarRootRef\.value\?\.ownerDocument[\s\S]*sourceDocument:\s*readCommandBarDocument\(\)/,
  'command bar should mark file-manager popup requests with its current document',
);

assert.match(
  workspaceView,
  /\.external-session-popout-terminal \.popout-workspace-root\s*\{[\s\S]*height:\s*100%;[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*hidden;/,
  'pop-out workspace root should fill the terminal host so panes keep their height',
);

assert.match(
  workspaceView,
  /\.external-session-popout-terminal \.layout-renderer-wrapper\s*\{[\s\S]*flex:\s*1[\s\S]*min-height:\s*0;/,
  'pop-out layout renderer should flex-fill the workspace root',
);

assert.match(
  fileEditorOverlay,
  /sessionId\?:\s*string\s*\|\s*null/,
  'file editor overlay should accept an optional session scope',
);

assert.match(
  fileEditorOverlay,
  /shouldHandlePopupForSession[\s\S]*props\.sessionId[\s\S]*poppedOutSessionIds/,
  'file editor overlay should scope popup triggers between the main window and pop-out sessions',
);

assert.match(
  fileEditorOverlay,
  /overlayRootRef[\s\S]*ownerDocument\.defaultView/,
  'file editor overlay should size itself from its own window',
);

assert.match(
  commandInputBar,
  /commandBarTeleportTarget[\s\S]*readCommandBarDocument\(\)\.body[\s\S]*<QuickCommandsModal[\s\S]*:teleport-target="commandBarTeleportTarget"/,
  'command bar modals should teleport into the command bar document',
);

assert.match(
  focusSwitcherStore,
  /ownerDocument\?:\s*Document[\s\S]*options:\s*FocusActionOptions[\s\S]*ownerDocument:\s*options\.ownerDocument/,
  'focus switcher actions should record their owner document',
);

assert.match(
  focusSwitcherStore,
  /focusTarget\(id:\s*string,\s*targetDocument\?:\s*Document[\s\S]*if\s*\(targetDocument && entry\.ownerDocument && entry\.ownerDocument !== targetDocument\)/,
  'focus switcher should skip actions from other documents',
);

assert.match(
  commandInputBar,
  /registerFocusAction\('commandInput', focusCommandInput, \{ ownerDocument: readCommandBarDocument\(\) \}\)[\s\S]*registerFocusAction\('terminalSearch', focusSearchInput, \{ ownerDocument: readCommandBarDocument\(\) \}\)/,
  'command input focus actions should be scoped to the command bar document',
);

assert.match(
  fileManager,
  /registerFocusAction\('fileManagerSearch', focusSearchActionWrapper, \{ ownerDocument: readFileManagerDocument\(\) \}\)[\s\S]*registerFocusAction\('fileManagerPathInput', focusPathActionWrapper, \{ ownerDocument: readFileManagerDocument\(\) \}\)/,
  'file manager focus actions should be scoped to the file manager document',
);

assert.match(
  fileManager,
  /readFileManagerClipboard[\s\S]*readFileManagerWindow\(\)\.navigator\.clipboard[\s\S]*readFileManagerClipboard\(\)\.writeText\(fullPath\)/,
  'file manager copy path should use the file manager document clipboard',
);

assert.match(
  fileManager,
  /activePathInputDocument = readFileManagerDocument\(\);[\s\S]*activePathInputDocument\.addEventListener\('click', handleClickOutsidePathInput\)/,
  'file manager path editor should bind outside-click handling to the file manager document',
);

assert.doesNotMatch(
  fileManager,
  /document\.addEventListener\('click', handleClickOutsidePathInput\)/,
  'file manager path editor should not bind outside-click handling to the main document',
);

assert.match(
  fileManager,
  /activeResizeDocument = \(event\.target as Node \| null\)\?\.ownerDocument \?\? readFileManagerDocument\(\);[\s\S]*activeResizeDocument\.addEventListener\('mousemove', handleResize\)/,
  'file manager column resize should bind pointer tracking to the file manager document',
);

assert.doesNotMatch(
  fileManager,
  /document\.addEventListener\('mousemove', handleResize\)/,
  'file manager column resize should not bind move tracking to the main document',
);

assert.match(
  fileEditorContainer,
  /registerFocusAction\('fileEditorActive', focusActiveEditor, \{ ownerDocument: editorContainerRef\.value\?\.ownerDocument \?\? document \}\)/,
  'file editor focus action should be scoped to the editor document',
);

assert.match(
  quickCommandsView,
  /registerFocusAction\('quickCommandsSearch', focusSearchInput, \{ ownerDocument: commandListContainerRef\.value\?\.ownerDocument \?\? document \}\)/,
  'quick commands focus action should be scoped to the quick command document',
);

assert.match(
  quickCommandsView,
  /readQuickCommandsClipboard[\s\S]*readQuickCommandsWindow\(\)\.navigator\.clipboard[\s\S]*readQuickCommandsClipboard\(\)\.writeText\(command\)/,
  'quick commands copy should use the quick command document clipboard',
);

assert.match(
  commandHistoryView,
  /registerFocusAction\('commandHistorySearch', focusSearchInput, \{ ownerDocument: historyListRef\.value\?\.ownerDocument \?\? document \}\)/,
  'command history focus action should be scoped to the command history document',
);

assert.match(
  commandHistoryView,
  /readCommandHistoryClipboard[\s\S]*readCommandHistoryWindow\(\)\.navigator\.clipboard[\s\S]*readCommandHistoryClipboard\(\)\.writeText\(command\)/,
  'command history copy should use the command history document clipboard',
);

assert.match(
  aiAssistantPanel,
  /assistantRootRef[\s\S]*readAssistantClipboard[\s\S]*readAssistantWindow\(\)\.navigator\.clipboard[\s\S]*readAssistantClipboard\(\)\?\.writeText\(command\)/,
  'AI assistant command copy should use the assistant document clipboard',
);

assert.match(
  statusMonitor,
  /statusMonitorRootRef[\s\S]*readStatusMonitorClipboard[\s\S]*readStatusMonitorWindow\(\)\.navigator\.clipboard[\s\S]*readStatusMonitorClipboard\(\)\.writeText\(ipAddress\)/,
  'status monitor IP copy should use the status monitor document clipboard',
);

assert.match(
  remoteDesktopSession,
  /getDisplayClipboard[\s\S]*getDisplayWindow\(\)\.navigator\.clipboard[\s\S]*getDisplayClipboard\(\)\.readText\(\)[\s\S]*getDisplayClipboard\(\)\.writeText\(text\)/,
  'remote desktop session clipboard sync should use the display document clipboard',
);

assert.match(
  remoteDesktopModal,
  /readRdpDisplayClipboard[\s\S]*readRdpDisplayWindow\(\)\.navigator\.clipboard[\s\S]*readRdpDisplayClipboard\(\)\.readText\(\)[\s\S]*readRdpDisplayClipboard\(\)\.writeText\(text\)/,
  'RDP modal clipboard sync should use the modal display document clipboard',
);

assert.match(
  vncModal,
  /readVncDisplayClipboard[\s\S]*readVncDisplayWindow\(\)\.navigator\.clipboard[\s\S]*readVncDisplayClipboard\(\)\.readText\(\)/,
  'VNC modal clipboard sync should use the modal display document clipboard',
);

for (const [componentName, source] of [
  ['RDP modal', remoteDesktopModal],
  ['remote desktop session', remoteDesktopSession],
  ['VNC modal', vncModal],
] as const) {
  assert.doesNotMatch(source, /status\.message/, `${componentName} must not display raw tunnel or client errors`);
  assert.doesNotMatch(source, /response\?\.data\?\.message/, `${componentName} must not display backend error messages`);
}

assert.match(
  commandInputBar,
  /<SuspendedSshSessionsModal[\s\S]*:teleport-target="commandBarTeleportTarget"/,
  'suspended SSH sessions modal should teleport into the command bar document',
);

assert.match(
  quickCommandsModal,
  /teleportTarget\?:\s*string\s*\|\s*HTMLElement[\s\S]*resolvedTeleportTarget[\s\S]*<teleport :to="resolvedTeleportTarget">/,
  'quick commands modal should support a caller-provided teleport target',
);

assert.match(
  quickCommandsModal,
  /readModalDocument[\s\S]*modalRootRef\.value\?\.ownerDocument[\s\S]*addEventListener\('keydown'/,
  'quick commands modal should bind Escape handling to its active document',
);

assert.doesNotMatch(
  quickCommandsModal,
  /document\.addEventListener\('keydown'/,
  'quick commands modal should not bind Escape handling to the main document',
);

assert.match(
  suspendedSshSessionsModal,
  /teleportTarget\?:\s*string\s*\|\s*HTMLElement[\s\S]*resolvedTeleportTarget[\s\S]*<teleport :to="resolvedTeleportTarget">/,
  'suspended SSH sessions modal should support a caller-provided teleport target',
);

assert.match(
  suspendedSshSessionsModal,
  /readModalDocument[\s\S]*modalRootRef\.value\?\.ownerDocument[\s\S]*addEventListener\('keydown'/,
  'suspended SSH sessions modal should bind Escape handling to its active document',
);

assert.doesNotMatch(
  suspendedSshSessionsModal,
  /document\.addEventListener\('keydown'/,
  'suspended SSH sessions modal should not bind Escape handling to the main document',
);

assert.match(
  focusSwitcherConfigurator,
  /teleportTarget\?:\s*string\s*\|\s*HTMLElement[\s\S]*resolvedTeleportTarget[\s\S]*<teleport :to="resolvedTeleportTarget">/,
  'focus switcher configurator should support a caller-provided teleport target',
);

assert.match(
  focusSwitcherConfigurator,
  /readDialogWindow[\s\S]*dialogRef\.value\?\.ownerDocument\.defaultView[\s\S]*innerWidth/,
  'focus switcher configurator should size and position against its active window',
);

assert.match(
  fileManagerActionModal,
  /activeModalDocument[\s\S]*ownerDocument/,
  'file manager action modal should listen for keys on its active document',
);

assert.doesNotMatch(
  fileManagerActionModal,
  /document\.addEventListener\('keydown'/,
  'file manager action modal should not bind key handlers to the main document',
);

assert.match(
  favoritePathsModal,
  /resolveModalWindow[\s\S]*defaultView/,
  'favorite paths modal should position and resize against its own window',
);

assert.doesNotMatch(
  favoritePathsModal,
  /const viewportWidth = window\.innerWidth/,
  'favorite paths modal should not use the main window for viewport positioning',
);

assert.match(
  draggableDialog,
  /activeDragDocument[\s\S]*ownerDocument/,
  'draggable dialogs should bind drag listeners to their active document',
);

assert.match(
  draggableDialog,
  /activeDragWindow[\s\S]*defaultView/,
  'draggable dialogs should bind drag listeners to their active window',
);

assert.match(
  resizable,
  /activeResizeWindow[\s\S]*ownerDocument\.defaultView/,
  'resizable dialogs should bind resize listeners to their active window',
);

assert.match(
  fileEditorContainer,
  /editorContainerRef[\s\S]*ownerDocument\.defaultView[\s\S]*addEventListener\('keydown'/,
  'layout editor pane should listen for shortcuts on its own window',
);

assert.match(
  fileEditorTabs,
  /activeContextMenuDocument[\s\S]*ownerDocument[\s\S]*addEventListener\('click'/,
  'file editor tab menus should close using their current document',
);

assert.match(
  quickCommandsView,
  /quickCommandTeleportTarget[\s\S]*ownerDocument\.body/,
  'quick command modals should teleport into their current document',
);

assert.match(
  quickCommandsView,
  /activeQuickCommandMenuDocument[\s\S]*eventDocument\.querySelector[\s\S]*menuWindow\.innerWidth/,
  'quick command context menu should use its current document and window',
);

assert.match(
  commandHistoryView,
  /activeCommandHistoryMenuDocument[\s\S]*eventDocument\.querySelector[\s\S]*menuWindow\.innerWidth/,
  'command history context menu should use its current document and window',
);

assert.match(
  workspaceConnectionList,
  /activeConnectionMenuDocument[\s\S]*eventDocument\.querySelector\('\.context-menu'\)[\s\S]*menuWindow\.innerWidth/,
  'workspace connection context menu should use its current document and window',
);

assert.match(
  workspaceConnectionList,
  /activeTagMenuDocument[\s\S]*eventDocument\.querySelector\('\.tag-context-menu'\)[\s\S]*menuWindow\.innerWidth/,
  'workspace connection tag context menu should use its current document and window',
);

assert.match(
  fileManager,
  /readFileManagerDocument[\s\S]*ownerDocument[\s\S]*createElement\('a'\)/,
  'file manager should create transient download links in its current document',
);

console.log('popout layout overlays behavior ok');

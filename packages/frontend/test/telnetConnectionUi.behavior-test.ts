import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const addForm = fs.readFileSync(path.resolve('src/composables/useAddConnectionForm.ts'), 'utf8');
const basicInfo = fs.readFileSync(path.resolve('src/components/AddConnectionFormBasicInfo.vue'), 'utf8');
const connectionStore = fs.readFileSync(path.resolve('src/stores/connections.store.ts'), 'utf8');
const sessionTypes = fs.readFileSync(path.resolve('src/stores/session/types.ts'), 'utf8');
const sessionActions = fs.readFileSync(path.resolve('src/stores/session/actions/sessionActions.ts'), 'utf8');
const webSocketManager = fs.readFileSync(path.resolve('src/composables/useWebSocketConnection.ts'), 'utf8');
const terminalManager = fs.readFileSync(path.resolve('src/composables/useSshTerminal.ts'), 'utf8');
const layoutRenderer = fs.readFileSync(path.resolve('src/components/LayoutRenderer.vue'), 'utf8');
const workspaceView = fs.readFileSync(path.resolve('src/views/WorkspaceView.vue'), 'utf8');
const commandInputBar = fs.readFileSync(path.resolve('src/components/CommandInputBar.vue'), 'utf8');
const commandInputActions = fs.readFileSync(path.resolve('src/stores/session/actions/commandInputActions.ts'), 'utf8');
const terminalTabBar = fs.readFileSync(path.resolve('src/components/TerminalTabBar.vue'), 'utf8');
const quickCommandsView = fs.readFileSync(path.resolve('src/views/QuickCommandsView.vue'), 'utf8');
const commandHistoryView = fs.readFileSync(path.resolve('src/views/CommandHistoryView.vue'), 'utf8');
const connectionsView = fs.readFileSync(path.resolve('src/views/ConnectionsView.vue'), 'utf8');
const zhCnLocale = fs.readFileSync(path.resolve('src/locales/zh-CN.json'), 'utf8');
const enUsLocale = fs.readFileSync(path.resolve('src/locales/en-US.json'), 'utf8');
const jaJpLocale = fs.readFileSync(path.resolve('src/locales/ja-JP.json'), 'utf8');

assert.match(addForm, /'TELNET'/);
assert.match(addForm, /telnetDefaultPort\s*=\s*23/);
assert.match(basicInfo, /typeTelnet/);
assert(
  basicInfo.indexOf("props.formData.type = 'TELNET'") > basicInfo.indexOf("props.formData.type = 'SSH'")
    && basicInfo.indexOf("props.formData.type = 'TELNET'") < basicInfo.indexOf("props.formData.type = 'RDP'"),
  'Telnet connection type button should be placed immediately after SSH',
);
assert.match(connectionStore, /'TELNET'/);
assert.match(sessionTypes, /'telnet'/);
assert.match(sessionActions, /openTelnetSession/);
assert.match(webSocketManager, /telnet:connect/);
assert.match(webSocketManager, /frontendSessionId:\s*instanceSessionId/);
assert.match(webSocketManager, /sendTelnetInput/);
assert.match(terminalManager, /telnet:output/);
assert.match(terminalManager, /telnet:resize/);
assert.match(terminalManager, /readTerminalMessageText/);
assert.match(terminalManager, /payloadRecord\.message \?\? payloadRecord\.error \?\? payloadRecord\.reason/);
assert.match(terminalManager, /getTerminalText\('genericErrorMsg', \{ message: errorMsg \}\)/);
for (const localeSource of [zhCnLocale, enUsLocale, jaJpLocale]) {
  assert.match(localeSource, /"genericErrorMsg"\s*:\s*"[^"]*\{message\}[^"]*"/);
  assert.match(localeSource, /"disconnectMsg"\s*:\s*"[^"]*\{reason\}[^"]*"/);
  assert.match(localeSource, /"unknownSshError"/);
  assert.match(localeSource, /"unknownGenericError"/);
}
assert.match(layoutRenderer, /sessionState\.kind === 'telnet'/);
const templateStart = layoutRenderer.indexOf('<template>');
assert.notEqual(templateStart, -1, 'LayoutRenderer template should exist');
const terminalComponentStart = layoutRenderer.indexOf(
  "sessionState.kind === 'ssh' || sessionState.kind === 'telnet'",
  templateStart,
);
assert.notEqual(terminalComponentStart, -1, 'Terminal component should render SSH and Telnet sessions');
const terminalComponentTagStart = layoutRenderer.lastIndexOf('<component', terminalComponentStart);
assert.notEqual(terminalComponentTagStart, -1, 'Terminal component tag should be found');
const terminalComponentSource = layoutRenderer.slice(
  terminalComponentTagStart,
  layoutRenderer.indexOf('/>', terminalComponentStart),
);
assert.match(
  terminalComponentSource,
  /:key="sessionId"/,
  'Terminal component instances must be keyed by sessionId so multiple Telnet windows do not reuse one terminal instance',
);
assert.doesNotMatch(
  layoutRenderer,
  /sessionState\.kind === 'ssh' \|\| sessionState\.kind === 'rdp' \|\| sessionState\.kind === 'vnc'/,
  'Telnet sessions must count as terminal sessions so the empty placeholder does not cover the terminal',
);
assert.match(workspaceView, /isTerminalShellSessionKind = \(kind\?: string\) => kind === 'ssh' \|\| kind === 'telnet'/);
assert.match(workspaceView, /const manager = isTerminalShellSessionKind\(session\?\.kind\)\s*\?\s*\(session\.terminalManager/);
assert.match(commandInputBar, /isTerminalShellSessionKind = \(kind\?: string\) => kind === 'ssh' \|\| kind === 'telnet'/);
assert.match(commandInputActions, /isTerminalShellSessionKind = \(kind\?: string\) => kind === 'ssh' \|\| kind === 'telnet'/);
assert.match(sessionActions, /isTerminalShellSessionKind = \(kind\?: string\) => kind === 'ssh' \|\| kind === 'telnet'/);
assert.match(sessionActions, /else if \(connection\.type === 'TELNET'\) \{\s*const connIdStr = String\(connection\.id\);\s*openTelnetSession\(connIdStr, \{ connectionsStore, t \}\);/s);
assert.doesNotMatch(sessionActions, /currentActiveSession\?\.kind === 'ssh' \|\| currentActiveSession\?\.kind === 'telnet'/);
assert.match(terminalTabBar, /isTerminalShellSessionKind = \(kind\?: string\) => kind === 'ssh' \|\| kind === 'telnet'/);
assert.match(terminalTabBar, /isTerminalShellSessionKind\(activeSessionState\.value\?\.kind\)/);
assert.match(quickCommandsView, /connInfo\?\.type === 'SSH' \|\| connInfo\?\.type === 'TELNET'/);
assert.match(commandHistoryView, /connInfo\?\.type === 'SSH' \|\| connInfo\?\.type === 'TELNET'/);
assert.match(addForm, /if \(!formData\.host \|\| \(formData\.type !== 'TELNET' && !formData\.username\)\)/);
assert.match(addForm, /username:\s*normalizeConnectionUsername\(formData\.username\)/);
assert.match(connectionsView, /const isConnectionTestSupported = \(type: ConnectionInfo\['type'\]\) => \['SSH', 'TELNET', 'RDP', 'VNC'\]\.includes\(type\)/);
assert.match(connectionsView, /const connectionsToTest = filteredAndSortedConnections\.value\.filter\(c => isConnectionTestSupported\(c\.type\) && c\.id != null\)/);
assert.doesNotMatch(connectionsView, /conn\.type === 'SSH' && connectionTestStates\.get\(conn\.id\)/);
const resultVisibilityMatch = connectionsView.match(/CONNECTION_TEST_RESULT_VISIBLE_MS\s*=\s*(\d+)/);
assert.ok(resultVisibilityMatch, 'connection test results should define an auto-hide duration');
const resultVisibilityMs = Number(resultVisibilityMatch[1]);
assert.ok(resultVisibilityMs >= 3000 && resultVisibilityMs <= 10000, 'connection test results should remain readable without lingering indefinitely');
assert.match(connectionsView, /connectionTestHideTimers = new Map<number, ReturnType<typeof setTimeout>>/);
assert.match(connectionsView, /scheduleConnectionTestStateAutoHide\(conn\.id\)/);
assert.match(connectionsView, /connectionTestHideTimers\.forEach\(timer => clearTimeout\(timer\)\)/);
assert.match(connectionsView, /connectionTestHideTimers\.clear\(\)/);

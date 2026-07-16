import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workspaceView = fs.readFileSync(path.resolve('src/views/WorkspaceView.vue'), 'utf8');
const terminal = fs.readFileSync(path.resolve('src/components/Terminal.vue'), 'utf8');
const remoteDesktopSession = fs.readFileSync(path.resolve('src/components/RemoteDesktopSession.vue'), 'utf8');

assert.match(
  workspaceView,
  /const requestTerminalSessionResize = \(sessionElement: HTMLElement\)[\s\S]*new eventWindow\.Event\(TERMINAL_RESIZE_EVENT\)/,
  'a terminal pop-out resize must notify its moved terminal component',
);

assert.match(
  workspaceView,
  /const resizeHandler = \(\) => \{[\s\S]*isTerminalShellSessionKind[\s\S]*requestTerminalSessionResize\(sessionElement\)[\s\S]*requestRemoteDesktopSessionResize\(sessionElement\)/,
  'the pop-out window resize handler must notify both terminal and remote-desktop sessions',
);

assert.match(
  terminal,
  /const TERMINAL_RESIZE_EVENT = 'terminal:resize-request';/,
  'terminal must expose a dedicated resize request event for pop-out windows',
);

assert.match(
  terminal,
  /syncTerminalResizeObserver[\s\S]*readTerminalWindow\(\)\.ResizeObserver[\s\S]*resizeObserver\.observe\(observedElement\)/,
  'terminal must recreate its ResizeObserver in the current owner window after being moved',
);

assert.match(
  terminal,
  /addEventListener\(TERMINAL_RESIZE_EVENT, handleExternalResizeRequest\)[\s\S]*removeEventListener\(TERMINAL_RESIZE_EVENT, handleExternalResizeRequest\)/,
  'terminal must register and clean up pop-out resize notifications',
);

assert.match(
  remoteDesktopSession,
  /syncResizeObserver[\s\S]*getDisplayWindow\(\)\.ResizeObserver[\s\S]*resizeObserver\.observe\(displayContainer\)/,
  'remote desktop must recreate its ResizeObserver in the current owner window after being moved',
);

assert.match(
  remoteDesktopSession,
  /handleExternalResizeRequest = \(\) => \{[\s\S]*syncResizeObserver\(\)[\s\S]*handleResizeSignal\(\)/,
  'remote desktop resize notifications must rebind observation before sending the new display size',
);

console.log('pop-out session resize behavior ok');

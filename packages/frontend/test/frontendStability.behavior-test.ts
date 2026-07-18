import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MAX_WEBSOCKET_RECONNECT_ATTEMPTS,
  resolveWebSocketReconnectDelayMs,
} from '../src/utils/webSocketReconnectPolicy';
import {
  createWorkspaceEventSubscriptionRegistry,
  workspaceEmitter,
} from '../src/composables/workspaceEvents';

const source = (file: string) => readFileSync(resolve('src', file), 'utf8');
const app = source('App.vue');
const websocket = source('composables/useWebSocketConnection.ts');
const workspace = source('views/WorkspaceView.vue');
const recording = source('components/settings/SessionRecordingSettings.vue');

assert.equal(MAX_WEBSOCKET_RECONNECT_ATTEMPTS, 8);
assert.equal(resolveWebSocketReconnectDelayMs(1, () => 0.5), 2_000);
assert.equal(resolveWebSocketReconnectDelayMs(8, () => 0.5), 30_000);
assert.equal(resolveWebSocketReconnectDelayMs(3, () => 0), 6_400);
assert.equal(resolveWebSocketReconnectDelayMs(3, () => 1), 9_600);

assert.match(websocket, /const connectionGeneration = \+\+activeConnectionGeneration/);
assert.match(websocket, /if \(!isCurrentConnection\(currentSocket, connectionGeneration\)\) return/);
assert.doesNotMatch(
  websocket.match(/currentSocket\.onerror = \(event\) => \{[\s\S]*?\n\s{12}\};/)?.[0] ?? '',
  /scheduleReconnect\(\)|ws\.value = null/,
);
assert.doesNotMatch(
  websocket.match(/currentSocket\.onopen = \(\) => \{[\s\S]*?\n\s{12}\};/)?.[0] ?? '',
  /reconnectAttempts = 0/,
);
assert.match(
  websocket.match(/message\.type === 'ssh:connected'[\s\S]*?\n\s{20}\}/)?.[0] ?? '',
  /reconnectAttempts = 0/,
);

let eventCount = 0;
const registry = createWorkspaceEventSubscriptionRegistry();
registry.subscribe('session:activate', () => {
  eventCount += 1;
});
workspaceEmitter.emit('session:activate', { sessionId: 'session-1' });
registry.disposeAll();
workspaceEmitter.emit('session:activate', { sessionId: 'session-1' });
registry.disposeAll();
assert.equal(eventCount, 1, 'disposing twice must not retain or duplicate workspace handlers');

assert.match(workspace, /workspaceEventSubscriptions\.disposeAll\(\)/);

assert.match(app, /useGlobalOverlayStore/);
assert.doesNotMatch(app, /useSessionStore|useFileEditorStore|useSettingsStore/);

assert.match(recording, /\}, 250\)/);
assert.match(
  recording.match(/recording\.onseek = \(position: number\) => \{[\s\S]*?\};/)?.[0] ?? '',
  /remoteDesktopSpeedSeekInProgress = false/,
);
assert.match(
  recording.match(/recording\.onpause = \(\) => \{[\s\S]*?\};/)?.[0] ?? '',
  /remoteDesktopSpeedSeekInProgress = false/,
);

console.log('frontend stability behavior ok');

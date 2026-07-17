import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const component = readFileSync(resolve('src/components/settings/SessionRecordingSettings.vue'), 'utf8');

assert.match(component, /hasInvalidRecordingIntegrity\(\)/);
assert.match(component, /sessionRecording\.integrity\.invalid/);
assert.match(component, /recordingIntegrity\.value = page\.integrity/);
assert.match(component, /if \(page\.integrity\.status === 'invalid'\)/);
assert.match(component, /Guacamole\.StaticHTTPTunnel/);
assert.match(component, /Guacamole\.SessionRecording/);
assert.match(component, /session-recordings\/\$\{selectedId\.value\}\/guacamole/);
assert.match(component, /isRemoteDesktopRecording/);
assert.match(component, /remoteDesktopRecordingReady/);
assert.match(component, /syncRemoteDesktopReplayDisplay/);
assert.match(component, /ResizeObserver\(syncRemoteDesktopReplayDisplay\)/);
assert.match(component, /remoteDesktopRecordingReady\.value = true/);
assert.match(component, /:disabled="preparing \|\| hasInvalidRecordingIntegrity\(\) \|\| \(isRemoteDesktopRecording && !remoteDesktopRecordingReady\)"/);
assert.match(component, /\.remote-desktop-recording-host :deep\(div\[style\*="position: absolute"\]:first-child\)\s*\{\s*z-index: 0;/);
assert.doesNotMatch(component, /<select v-model\.number="speed" :disabled="isRemoteDesktopRecording">/);
assert.match(component, /startRemoteDesktopSpeedController/);
assert.match(component, /remoteDesktopRecording\?\.seek\(targetPosition\)/);
assert.match(component, /if \(remoteDesktopSpeedSeekInProgress\) return;/);
assert.match(component, /recordingPlayerExpanded/);
assert.match(component, /recording-player--expanded/);
assert.match(component, /fa-window-maximize/);
assert.match(component, /fa-window-restore/);

console.log('session recording integrity UI behavior ok');

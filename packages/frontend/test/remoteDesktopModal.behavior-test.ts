import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rdp = readFileSync(resolve('src/components/RemoteDesktopModal.vue'), 'utf8');
const vnc = readFileSync(resolve('src/components/VncModal.vue'), 'utf8');
for (const source of [rdp, vnc]) {
  assert.match(source, /displayResizeObserver/);
  assert.match(source, /isDisplayRefreshNeeded/);
  assert.match(source, /refreshRemoteDisplay/);
  assert.match(source, /@keydown\.enter\.capture/);
  assert.match(source, /reconnectButtonRef/);
  assert.match(source, /new Guacamole\.Keyboard\((?:rdp|vnc)ContainerRef\.value/);
  assert.doesNotMatch(source, /watchEffect\(\(\) => \{[\s\S]*?sendSize\(/);
}
console.log('remote desktop modal behavior passed');

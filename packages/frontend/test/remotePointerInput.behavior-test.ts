import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const componentPath of [
  'src/components/RemoteDesktopSession.vue',
  'src/components/RemoteDesktopModal.vue',
  'src/components/VncModal.vue',
]) {
  const source = readFileSync(resolve(import.meta.dirname, '..', 'packages/frontend', componentPath), 'utf8');
  assert.doesNotMatch(source, /createRemotePointerScheduler/, `${componentPath} must not add a frame of pointer latency`);
  assert.match(
    source,
    /mouse\.value\.onmousemove\s*=\s*mouse\.value\.onmousedown\s*=\s*mouse\.value\.onmouseup\s*=\s*\(mouseState[^)]*\)\s*=>\s*\{\s*guacClient\.value\?\.sendMouseState\(mouseState\)/,
    `${componentPath} must forward every pointer state immediately`,
  );
}

console.log('remote pointer input behavior passed');

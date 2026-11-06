import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve('src/components/RemoteDesktopSession.vue'), 'utf8');
assert.match(source, /isManualResolutionEnabled\.value = currentSettings\[\`\$\{prefix\}DefaultFixedResolution\`\] !== 'false'/);
assert.match(source, /isDisplayRefreshNeeded/);
assert.match(source, /@keydown="captureRemoteKeyboard"/);
assert.match(source, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
assert.match(source, /sendCurrentSize\(\{ force: true \}\)/);
assert.match(source, /sendMouseState\(mouseState, true\)/);
assert.match(source, /user-select: none/);
console.log('remote desktop session behavior passed');

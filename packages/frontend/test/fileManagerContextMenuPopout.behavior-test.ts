import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const fileManagerSource = fs.readFileSync(path.resolve('src/components/FileManager.vue'), 'utf8');
const contextMenuSource = fs.readFileSync(path.resolve('src/components/FileManagerContextMenu.vue'), 'utf8');
const contextMenuComposableSource = fs.readFileSync(path.resolve('src/composables/file-manager/useFileManagerContextMenu.ts'), 'utf8');

assert.match(fileManagerSource, /contextMenuTeleportTarget/);
assert.match(fileManagerSource, /ownerDocument\.body/);
assert.match(contextMenuSource, /teleportTarget/);
assert.match(contextMenuSource, /<Teleport\s+:to="teleportTarget">/);
assert.match(contextMenuSource, /resolveMenuDocument/);
assert.match(contextMenuSource, /ownerDocument\.defaultView/);
assert.match(contextMenuComposableSource, /activeMenuDocument/);
assert.match(contextMenuComposableSource, /readEventDocument/);
assert.match(contextMenuComposableSource, /ownerDocument\.defaultView/);
assert.doesNotMatch(contextMenuComposableSource, /window\.innerWidth/);

console.log('fileManagerContextMenu popout behavior ok');

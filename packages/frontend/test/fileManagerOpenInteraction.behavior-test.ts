import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const selection = readFileSync(resolve('src/composables/file-manager/useFileManagerSelection.ts'), 'utf8');
const contextMenu = readFileSync(resolve('src/composables/file-manager/useFileManagerContextMenu.ts'), 'utf8');
const fileManager = readFileSync(resolve('src/components/FileManager.vue'), 'utf8');
const contextMenuComponent = readFileSync(resolve('src/components/FileManagerContextMenu.vue'), 'utf8');

assert.match(
  selection,
  /const\s+handleItemDoubleClick\s*=/,
  'file manager selection should expose a double-click action handler',
);

assert.match(
  selection,
  /handleItemDoubleClick[\s\S]*onItemAction\(item\)/,
  'double-click handler should perform the open/navigation action',
);

assert.doesNotMatch(
  selection,
  /else\s*\{[\s\S]*shouldPerformAction\s*=\s*true;[\s\S]*\}/,
  'plain single click should not perform the open/navigation action',
);

assert.match(
  fileManager,
  /handleItemDoubleClick:\s*originalHandleItemDoubleClick/,
  'FileManager should receive the selection double-click handler',
);

assert.match(
  fileManager,
  /@dblclick="handleItemDoubleClick\(\$event,\s*item\)"/,
  'file rows should open on double click',
);

assert.match(
  fileManager,
  /onEnterPress:\s*\(item\)\s*=>\s*handleItemAction\(item\)/,
  'keyboard Enter should keep opening the selected item directly',
);

assert.match(
  contextMenu,
  /onOpen:\s*\(item:\s*FileListItem\)\s*=>\s*void/,
  'context menu should accept an open/edit callback',
);

assert.match(
  contextMenu,
  /fileManager\.actions\.openEditor[\s\S]*onOpen\(targetItem\)/,
  'single-file context menu should include an open editor action',
);

assert.match(
  fileManager,
  /onOpen:\s*handleOpenContextMenuClick/,
  'FileManager should wire the context menu open action',
);

assert.match(
  fileManager,
  /showWarning\(\s*t\('fileManager\.errors\.unknownSymlinkTargetType'/,
  'unknown symlink targets should warn instead of opening as a file',
);

assert.doesNotMatch(
  fileManager,
  /Defaulting to open as file/,
  'unknown symlink targets should no longer default to opening as files',
);

assert.match(
  contextMenuComponent,
  /<Teleport\s+to="body">[\s\S]*ref="contextMenuRef"/,
  'file manager context menu should teleport to body so layout panes cannot clip or hide it',
);

console.log('file manager open interaction behavior ok');

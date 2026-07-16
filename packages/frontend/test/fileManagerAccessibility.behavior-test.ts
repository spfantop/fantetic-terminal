import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const fileManager = fs.readFileSync(path.resolve(process.cwd(), 'src/components/FileManager.vue'), 'utf8');

assert.match(
  fileManager,
  /<button\s+v-show="!isEditingPath && !showPathHistoryDropdown"[\s\S]{0,500}:aria-label="t\('fileManager\.editPathTooltip'\)"[\s\S]{0,500}:disabled="!currentSftpManager \|\| !props\.wsDeps\.isConnected\.value"/,
  'the current path must be a named native button with an explicit disconnected state',
);
assert.doesNotMatch(
  fileManager,
  /<span\s+v-show="!isEditingPath && !showPathHistoryDropdown"[^>]*@click="startPathEdit"/,
  'the current path must not rely on a pointer-only span',
);

for (const labelKey of [
  'fileManager.actions.cdToTerminal',
  'fileManager.actions.refresh',
  'fileManager.actions.parentDirectory',
  'fileManager.searchPlaceholder',
  'favoritePaths.open',
]) {
  assert.match(
    fileManager,
    new RegExp(`:aria-label="t\\('${labelKey.replaceAll('.', '\\.')}`),
    `the ${labelKey} icon control must expose an accessible name`,
  );
}
assert.match(fileManager, /:aria-label="isMultiSelectMode \? t\('fileManager\.actions\.exitMultiSelect'\) : t\('fileManager\.actions\.multiSelect'\)"/);

assert.match(fileManager, /ref="searchInputRef"[\s\S]{0,350}:aria-label="t\('fileManager\.searchPlaceholder'\)"/);
assert.match(fileManager, /ref="pathInputRef"[\s\S]{0,350}:aria-label="t\('fileManager\.currentPath'\)"/);

assert.doesNotMatch(fileManager, /<th\s+@click="handleSort/);
for (const [key, index] of [['type', 0], ['filename', 1], ['size', 2], ['mtime', 4]] as const) {
  assert.match(
    fileManager,
    new RegExp(`:aria-sort="sortKey === '${key}' \\? \\(sortDirection === 'asc' \\? 'ascending' : 'descending'\\) : 'none'"`),
    `the ${key} column must expose its sort direction`,
  );
  assert.match(fileManager, new RegExp(`<button[^>]*@click="handleSort\\('${key}'\\)"`));
  if (index < 4) {
    assert.match(fileManager, new RegExp(`@keydown\\.left\\.prevent="resizeColumnByKeyboard\\(${index}, -1\\)"`));
    assert.match(fileManager, new RegExp(`@keydown\\.right\\.prevent="resizeColumnByKeyboard\\(${index}, 1\\)"`));
  }
}
assert.match(fileManager, /@keydown\.left\.prevent="resizeColumnByKeyboard\(3, -1\)"/);
assert.match(fileManager, /@keydown\.right\.prevent="resizeColumnByKeyboard\(3, 1\)"/);
assert.match(fileManager, /ref="fileListContainerRef"[\s\S]{0,600}:aria-label="t\('fileManager\.fileList'\)"/);
assert.match(fileManager, /<caption class="sr-only">\{\{ t\('fileManager\.fileList'\) \}\}<\/caption>/);

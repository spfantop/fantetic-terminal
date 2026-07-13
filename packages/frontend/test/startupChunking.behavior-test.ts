import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.vue'), 'utf8');

assert.doesNotMatch(appSource, /import FileEditorOverlay from/);
assert.doesNotMatch(appSource, /import SettingsView from/);
assert.match(appSource, /const FileEditorOverlay = defineAsyncComponent/);
assert.match(appSource, /const SettingsView = defineAsyncComponent/);

console.log('startup chunking behavior ok');

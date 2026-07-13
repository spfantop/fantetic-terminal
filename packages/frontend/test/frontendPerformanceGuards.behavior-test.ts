import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (file: string) => readFileSync(resolve('src', file), 'utf8');
const main = source('main.ts');
const app = source('App.vue');
const adminCenter = source('views/AdminCenterView.vue');
const settings = source('views/SettingsView.vue');
const fileEditorOverlay = source('components/FileEditorOverlay.vue');

assert.doesNotMatch(main, /element-plus/);
assert.match(app, /useFileEditorStore/);
assert.match(app, /popupFileInfo/);
assert.match(app, /v-if="shouldMountPopupFileEditor"/);
assert.doesNotMatch(app, /<FileEditorOverlay v-if="showPopupFileEditorBoolean"/);
assert.match(fileEditorOverlay, /const MonacoEditor = defineAsyncComponent/);
assert.doesNotMatch(fileEditorOverlay, /import MonacoEditor from/);

for (const component of ['AccessControlSettings', 'SessionRecordingSettings', 'DataManagementSection', 'AuditLogView']) {
  assert.match(adminCenter, new RegExp(`const ${component} = defineAsyncComponent`));
  assert.doesNotMatch(adminCenter, new RegExp(`import ${component} from`));
}

for (const component of ['WorkspaceSettingsSection', 'AISettingsSection', 'SystemSettingsSection', 'AppearanceSection', 'ProxiesView', 'NotificationsView', 'AboutSection']) {
  assert.match(settings, new RegExp(`const ${component} = defineAsyncComponent`));
  assert.doesNotMatch(settings, new RegExp(`import ${component} from`));
}

console.log('frontend performance guards behavior ok');

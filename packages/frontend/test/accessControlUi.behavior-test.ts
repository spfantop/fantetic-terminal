import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), 'src', relativePath), 'utf8');
const settings = source('views/SettingsView.vue');
const component = source('components/settings/AccessControlSettings.vue');
const api = source('services/accessControl.api.ts');

assert.match(settings, /role === 'super_admin' \|\| role === 'admin'/);
assert.match(settings, /role === 'auditor'/);
assert.match(settings, /activeTab === 'accessControl'/);
assert.match(component, /transferToUserId/);
assert.match(component, /password\.length < 12/);
assert.match(component, /saveMember/);
assert.match(api, /\/access-control/);
assert.match(api, /\/groups\/\$\{groupId\}\/members\/\$\{userId\}/);

console.log('access control UI behavior ok');

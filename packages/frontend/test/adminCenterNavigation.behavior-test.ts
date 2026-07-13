import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (file: string) => readFileSync(resolve('src', file), 'utf8');
const router = source('router/index.ts');
const connections = source('views/ConnectionsView.vue');
const settings = source('views/SettingsView.vue');
const adminCenter = source('views/AdminCenterView.vue');

assert.match(router, /path:\s*'\/admin'[\s\S]*name:\s*'AdminCenter'/);
assert.match(router, /allowedRoles:\s*\['super_admin',\s*'admin',\s*'auditor'\]/);
assert.match(router, /to\.meta\.allowedRoles/);
assert.match(connections, /name:\s*'AdminCenter'/);
assert.match(connections, /canOpenAdminCenter/);

assert.doesNotMatch(settings, /AccessControlSettings/);
assert.doesNotMatch(settings, /SessionRecordingSettings/);
assert.doesNotMatch(settings, /AuditLogView/);
assert.doesNotMatch(settings, /DataManagementSection/);

assert.match(adminCenter, /AccessControlSettings/);
assert.match(adminCenter, /SessionRecordingSettings/);
assert.match(adminCenter, /AuditLogView/);
assert.match(adminCenter, /DataManagementSection/);
assert.match(adminCenter, /admin-center-navigation/);
assert.match(adminCenter, /aria-current/);

console.log('admin center navigation behavior tests passed');

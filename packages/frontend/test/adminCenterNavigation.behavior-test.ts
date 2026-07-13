import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (file: string) => readFileSync(resolve('src', file), 'utf8');
const router = source('router/index.ts');
const connections = source('views/ConnectionsView.vue');
const settings = source('views/SettingsView.vue');
const adminCenter = source('views/AdminCenterView.vue');
const app = source('App.vue');

assert.match(router, /path:\s*'\/admin'[\s\S]*name:\s*'AdminCenter'/);
assert.match(router, /allowedRoles:\s*\['super_admin',\s*'admin',\s*'auditor'\]/);
assert.match(router, /to\.meta\.allowedRoles/);
assert.match(router, /query:\s*\{[^}]*admin:\s*'1'/);
assert.match(connections, /name:\s*'AdminCenter'/);
assert.match(connections, /canOpenAdminCenter/);
assert.match(app, /isAdminCenterOverlayVisible/);
assert.match(app, /<AdminCenterView[\s\S]*is-dialog[\s\S]*@close="closeAdminCenterOverlay"/);

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
assert.match(adminCenter, /isDialog/);
assert.match(adminCenter, /admin-center-dialog-layer/);
assert.match(adminCenter, /admin-center-close/);
assert.match(adminCenter, /event\.key === 'Escape'/);
assert.match(adminCenter, /useDraggableDialog/);
assert.match(adminCenter, /admin-dialog-drag-handle/);
assert.doesNotMatch(adminCenter, /<RouterLink[^>]*class="admin-center-back"/);

console.log('admin center navigation behavior tests passed');

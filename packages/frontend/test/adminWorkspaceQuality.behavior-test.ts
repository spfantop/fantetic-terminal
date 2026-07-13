import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const admin = readFileSync(resolve('src/views/AdminCenterView.vue'), 'utf8');
const pagination = readFileSync(resolve('src/components/admin/AdminPagination.vue'), 'utf8');
const recording = readFileSync(resolve('src/components/settings/SessionRecordingSettings.vue'), 'utf8');
const audit = readFileSync(resolve('src/views/AuditLogView.vue'), 'utf8');
const access = readFileSync(resolve('src/components/settings/AccessControlSettings.vue'), 'utf8');
const data = readFileSync(resolve('src/components/settings/DataManagementSection.vue'), 'utf8');
const managedSources = [admin, pagination, recording, audit, access, data];

assert.match(admin, /overviewStats/);
assert.match(admin, /loadOverviewStats/);
assert.match(admin, /overview-loading/);
assert.match(pagination, /aria-label/);
assert.match(pagination, /aria-current/);
assert.match(pagination, /focus-visible/);
assert.match(recording, /AdminPagination/);
assert.match(audit, /AdminPagination/);
for (const source of managedSources) {
  assert.doesNotMatch(source, /hsl\(var\(--/);
}
assert.match(admin, /--background:var\(--app-bg-color\)/);
assert.match(admin, /--border:var\(--border-color\)/);
assert.match(admin, /--primary:var\(--link-active-color\)/);
assert.doesNotMatch(admin, /admin-center-eyebrow/);
assert.doesNotMatch(admin, /adminCenter\.description/);
assert.doesNotMatch(admin, /activeItem\.description/);
assert.doesNotMatch(admin, /item\.description/);

console.log('admin workspace quality behavior ok');

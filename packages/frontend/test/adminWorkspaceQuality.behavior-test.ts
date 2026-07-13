import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const admin = readFileSync(resolve('src/views/AdminCenterView.vue'), 'utf8');
const pagination = readFileSync(resolve('src/components/admin/AdminPagination.vue'), 'utf8');
const recording = readFileSync(resolve('src/components/settings/SessionRecordingSettings.vue'), 'utf8');
const audit = readFileSync(resolve('src/views/AuditLogView.vue'), 'utf8');

assert.match(admin, /overviewStats/);
assert.match(admin, /loadOverviewStats/);
assert.match(admin, /overview-loading/);
assert.match(pagination, /aria-label/);
assert.match(pagination, /aria-current/);
assert.match(pagination, /focus-visible/);
assert.match(recording, /AdminPagination/);
assert.match(audit, /AdminPagination/);

console.log('admin workspace quality behavior ok');

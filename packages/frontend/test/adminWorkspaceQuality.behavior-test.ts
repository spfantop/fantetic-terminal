import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const admin = readFileSync(resolve('src/views/AdminCenterView.vue'), 'utf8');
const pagination = readFileSync(resolve('src/components/admin/AdminPagination.vue'), 'utf8');
const recording = readFileSync(resolve('src/components/settings/SessionRecordingSettings.vue'), 'utf8');
const audit = readFileSync(resolve('src/views/AuditLogView.vue'), 'utf8');
const access = readFileSync(resolve('src/components/settings/AccessControlSettings.vue'), 'utf8');
const data = readFileSync(resolve('src/components/settings/DataManagementSection.vue'), 'utf8');
const dateRange = readFileSync(resolve('src/components/admin/AdminDateRange.vue'), 'utf8');
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
assert.match(admin, /--admin-font-base:/);
assert.match(dateRange, /role="dialog"/);
assert.doesNotMatch(dateRange, /adminDateRange\.(today|last7Days|last30Days)/);
assert.doesNotMatch(dateRange, /date-presets/);
assert.match(dateRange, /calendar-popover/);
assert.match(dateRange, /calendarDays/);
assert.match(dateRange, /container-type:inline-size/);
assert.match(dateRange, /grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/);
assert.doesNotMatch(dateRange, /min-width:21rem/);
assert.match(dateRange, /@container\(max-width:16rem\)/);
assert.doesNotMatch(dateRange, /@container\(max-width:22rem\)/);
assert.match(audit, /AdminDateRange/);
assert.match(recording, /AdminDateRange/);
assert.doesNotMatch(audit, />success<|>failure<|>denied<|>Session ID<|>Asset ID</);
assert.doesNotMatch(recording, /\}\} events/);
assert.doesNotMatch(access, /<option[^>]*>\s*(user|auditor|admin|super_admin|active|disabled|viewer|operator|owner|view|connect|manage)\s*<\/option>/);
assert.match(audit, /\.audit-workspace button\{background:var\(--background\)/);
assert.match(recording, /\.recording-workspace button\{background:var\(--background\)/);
assert.match(access, /\.access-control button\{background:var\(--background\)/);
assert.match(data, /\.data-workspace button\{background:var\(--background\)/);
assert.match(audit, /class="audit-filter-actions"/);
assert.match(audit, /class="audit-filter-field audit-filter-action"/);
assert.match(audit, /class="audit-filter-field audit-filter-result"/);
assert.match(audit, /grid-template-columns:minmax\(12rem,1\.3fr\)/);
assert.match(audit, /\.audit-filter-actions button\{white-space:nowrap/);
assert.match(recording, /grid-template-columns:minmax\(13rem,1\.4fr\)/);
assert.match(recording, /height:min\(48rem,calc\(100dvh - 3rem\)\)/);
assert.match(data, /class="primary"[^>]*@click="createBackup"/);
assert.doesNotMatch(data, /backup-pane>header button:first-of-type/);
assert.match(access, /<option :value="undefined" disabled>/);
for (const locale of ['zh-CN', 'en-US', 'ja-JP']) {
  const messages = JSON.parse(readFileSync(resolve(`src/locales/${locale}.json`), 'utf8'));
  assert.equal(typeof messages.common.reset, 'string');
  assert.equal(typeof messages.common.actions, 'string');
  assert.equal(typeof messages.common.refresh, 'string');
}

console.log('admin workspace quality behavior ok');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const view = readFileSync(resolve('src/views/AuditLogView.vue'), 'utf8');
const store = readFileSync(resolve('src/stores/audit.store.ts'), 'utf8');

assert.match(store, /startDate/);
assert.match(store, /endDate/);
assert.match(store, /result/);
assert.match(view, /selectedLog/);
assert.match(view, /audit-detail/);
assert.match(view, /openRelatedRecordings/);
assert.match(view, /AdminDateRange/);
assert.match(view, /endDate: readDateSeconds\(endDateInput\.value, true\)/);
assert.match(view, /filterValidationError/);
assert.match(view, /adminDateRange\.invalidRange/);
assert.match(view, /aria-current/);
assert.match(view, /audit-detail-row/);
assert.doesNotMatch(view, /<aside class="audit-detail"/);

console.log('audit investigation workspace behavior ok');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const component = fs.readFileSync(path.resolve(process.cwd(), 'src/components/settings/DataManagementSection.vue'), 'utf8');
const api = fs.readFileSync(path.resolve(process.cwd(), 'src/services/backup.api.ts'), 'utf8');
const adminCenter = fs.readFileSync(path.resolve(process.cwd(), 'src/views/AdminCenterView.vue'), 'utf8');
assert.match(adminCenter, /dataManagement[\s\S]*administratorRoles/);
assert.match(component, /scheduleRestore/);
assert.match(component, /confirmRestore/);
assert.match(component, /dataPane/);
assert.match(component, /restoreStep/);
assert.match(component, /verifySelectedBackup/);
assert.match(component, /showConfirmDialog/);
assert.doesNotMatch(component, /window\.confirm/);
assert.doesNotMatch(component, /v-if="settings"/);
assert.match(api, /\/backups\/\$\{backupId\}\/verify/);
assert.match(api, /\/backups\/\$\{backupId\}\/restore/);
console.log('backup management behavior ok');

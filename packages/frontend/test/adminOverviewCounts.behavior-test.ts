import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const view = fs.readFileSync(path.join(root, 'src/views/AdminCenterView.vue'), 'utf8');
const accessApi = fs.readFileSync(path.join(root, 'src/services/accessControl.api.ts'), 'utf8');
const backupApi = fs.readFileSync(path.join(root, 'src/services/backup.api.ts'), 'utf8');

assert.match(accessApi, /readSummary/);
assert.match(backupApi, /readCount/);
assert.doesNotMatch(view, /listUsers\(\)\)\.length/);
assert.doesNotMatch(view, /listGroups\(\)\)\.length/);
assert.doesNotMatch(view, /listConnections\(\)\)\.length/);
assert.doesNotMatch(view, /backupApi\.list\(\)\)\.length/);

console.log('admin overview counts behavior ok');

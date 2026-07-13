import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), 'src', relativePath), 'utf8');
const adminCenter = source('views/AdminCenterView.vue');
const component = source('components/settings/AccessControlSettings.vue');
const api = source('services/accessControl.api.ts');

assert.match(adminCenter, /administratorRoles: SystemRole\[\] = \['super_admin', 'admin'\]/);
assert.match(adminCenter, /'auditor'/);
assert.match(adminCenter, /activeSection === 'accessControl'/);
assert.match(component, /transferToUserId/);
assert.match(component, /activePane/);
assert.match(component, /filteredUsers/);
assert.match(component, /filteredConnections/);
assert.match(component, /selectedConnectionIds/);
assert.match(component, /saveConnectionGrants/);
assert.match(component, /grant-matrix/);
assert.match(component, /updateGroup/);
assert.match(component, /showConfirmDialog/);
assert.doesNotMatch(component, /window\.confirm/);
assert.match(component, /password\.length < 12/);
assert.match(component, /saveMember/);
assert.match(api, /\/access-control/);
assert.match(api, /\/groups\/\$\{groupId\}\/members\/\$\{userId\}/);
assert.match(component, /assetPermissions/);
assert.match(component, /saveConnectionGrant/);
assert.match(component, /deleteConnectionGrant/);
assert.match(api, /\/connections\/\$\{connectionId\}\/groups\/\$\{groupId\}/);

console.log('access control UI behavior ok');

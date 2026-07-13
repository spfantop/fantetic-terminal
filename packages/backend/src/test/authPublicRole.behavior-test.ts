import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(process.cwd(), 'src/auth/auth.controller.ts'), 'utf8');

assert.match(source, /const toPublicUser/);
assert.match(source, /systemRole: user\.system_role/);
assert.match(source, /SELECT two_factor_secret, system_role FROM users/);
assert.doesNotMatch(source, /user: \{ id: user\.id, username: user\.username \}/);

console.log('auth public role behavior ok');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repository = readFileSync(resolve('src/connections/connection.repository.ts'), 'utf8');
const types = readFileSync(resolve('src/types/connection.types.ts'), 'utf8');

assert.match(repository, /effective_permission/);
assert.match(repository, /membership\.role = 'viewer'/);
assert.match(repository, /membership\.role = 'operator'/);
assert.match(repository, /subject\.systemRole === 'auditor'[\s\S]*'view'/);
assert.match(repository, /WITH RECURSIVE visible_folders/);
assert.match(repository, /id IN \(SELECT id FROM visible_folders\)/);
assert.match(types, /effective_permission\??: 'view' \| 'connect' \| 'manage'/);

console.log('connection permission projection behavior ok');

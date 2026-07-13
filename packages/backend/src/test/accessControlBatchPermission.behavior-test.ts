import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'src/access-control');
const application = fs.readFileSync(path.join(root, 'access-control.application.ts'), 'utf8');
const repository = fs.readFileSync(path.join(root, 'access-control.repository.ts'), 'utf8');

assert.match(application, /readConnectionAccessList\(subject\.userId, connectionIds\)/);
assert.doesNotMatch(application, /for \(const connectionId of connectionIds\) \{\s*await this\.requireConnectionPermission/);
assert.match(repository, /async readConnectionAccessList/);

console.log('access control batch permission behavior ok');

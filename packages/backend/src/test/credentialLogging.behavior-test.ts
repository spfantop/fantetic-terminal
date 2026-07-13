import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sourceRoot = path.resolve(process.cwd(), 'src');
const readSource = (relativePath: string): string => fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');

const serviceSource = readSource('connections/connection.service.ts');
const repositorySource = readSource('connections/connection.repository.ts');

assert.doesNotMatch(serviceSource, /JSON\.stringify\(input/);
assert.doesNotMatch(repositorySource, /JSON\.stringify\(data\s*[,)]/);
assert.doesNotMatch(repositorySource, /JSON\.stringify\(params\s*[,)]/);
assert.match(serviceSource, /createLogger\(['"]ConnectionService['"]\)/);
assert.match(repositorySource, /createLogger\(['"]ConnectionRepository['"]\)/);

console.log('credential logging behavior ok');

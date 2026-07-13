import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sourceRoot = path.resolve(process.cwd(), 'src');
const controllerSource = fs.readFileSync(path.join(sourceRoot, 'audit/audit.controller.ts'), 'utf8');

assert.match(controllerSource, /MAX_AUDIT_PAGE_SIZE\s*=\s*200/);
assert.match(controllerSource, /limit\s*>\s*MAX_AUDIT_PAGE_SIZE/);
assert.match(controllerSource, /MAX_AUDIT_SEARCH_LENGTH\s*=\s*200/);

console.log('audit pagination behavior ok');

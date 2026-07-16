import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const controllerSource = fs.readFileSync(
  path.join(process.cwd(), 'src/terminal-themes/terminal-theme.controller.ts'),
  'utf8',
);

assert.match(
  controllerSource,
  /ensureAndGetPathInAppData\('temp-uploads'\)/,
  'Terminal theme imports must use the writable app-data volume for temporary uploads',
);
assert.doesNotMatch(
  controllerSource,
  /path\.join\(__dirname, '\.\.\/\.\.\/temp-uploads\/'\)/,
  'Terminal theme imports must not write to the read-only application image directory',
);

console.log('terminal theme upload storage behavior passed');

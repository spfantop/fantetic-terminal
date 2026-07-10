import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootPackage = JSON.parse(readFileSync(resolve('../../package.json'), 'utf8')) as { version?: string };
const frontendPackage = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const versionFilePath = resolve('public/VERSION');
const syncScriptPath = resolve('../../build-tools/sync-frontend-version.js');
const electronPackagePath = resolve('../../electron-app/package.json');

assert.match(rootPackage.version ?? '', /^\d+\.\d+\.\d+/, 'root package version should be the release version source');
assert.equal(existsSync(syncScriptPath), true, 'frontend version should be generated from the root package version');
assert.equal(
  frontendPackage.scripts?.prebuild,
  'node ../../build-tools/sync-frontend-version.js',
  'frontend builds should synchronize VERSION before Vite copies public assets',
);
assert.equal(
  readFileSync(versionFilePath, 'utf8').trim(),
  rootPackage.version,
  'checked-in VERSION should match the root package version for development servers',
);

if (existsSync(electronPackagePath)) {
  const electronPackage = JSON.parse(readFileSync(electronPackagePath, 'utf8')) as {
    version?: string;
    scripts?: Record<string, string>;
  };
  assert.equal(
    electronPackage.version,
    rootPackage.version,
    'Electron package metadata should match the root release version',
  );
  assert.match(
    electronPackage.scripts?.build ?? '',
    /sync-frontend-version/,
    'Electron builds should synchronize package metadata before electron-builder reads it',
  );
}

console.log('frontend version metadata behavior tests passed');

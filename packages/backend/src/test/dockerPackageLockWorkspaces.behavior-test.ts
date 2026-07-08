import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve('../..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const rootLockfile = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));

const workspacePatterns = rootPackage.workspaces ?? [];
assert.deepEqual(
  workspacePatterns,
  ['packages/*'],
  'test expects the root workspaces pattern used by Docker package installs',
);

const workspaceRoot = path.join(repoRoot, 'packages');
const existingWorkspacePackagePaths = new Set(
  fs.readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(workspaceRoot, entry.name, 'package.json')))
    .map((entry) => `packages/${entry.name}`),
);

const lockfileWorkspacePackagePaths = Object.keys(rootLockfile.packages ?? {})
  .filter((packagePath) => packagePath.startsWith('packages/'))
  .filter((packagePath) => packagePath.split('/').length === 2);

const staleWorkspacePackagePaths = lockfileWorkspacePackagePaths
  .filter((packagePath) => !existingWorkspacePackagePaths.has(packagePath));

assert.deepEqual(
  staleWorkspacePackagePaths,
  [],
  'package-lock.json should not retain removed workspace packages because Docker npm install reads only package metadata',
);

const missingVersionPackagePaths = Object.entries(rootLockfile.packages ?? {})
  .filter(([packagePath, packageInfo]) => {
    const info = packageInfo as { link?: boolean; version?: string };
    return packagePath !== '' && !info.link && !Object.prototype.hasOwnProperty.call(info, 'version');
  })
  .map(([packagePath]) => packagePath);

assert.deepEqual(
  missingVersionPackagePaths,
  [],
  'package-lock.json non-link package entries should include version because npm 10 Docker installs compare package versions during dedupe',
);

console.log('docker package lock workspaces behavior ok');

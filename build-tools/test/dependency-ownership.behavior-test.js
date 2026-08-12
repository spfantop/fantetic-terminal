const assert = require('node:assert/strict');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');

const {
  collectRuntimeDependencyLockKeys,
} = require('../../electron-app/build-tools/prepare-runtime');

const repositoryRoot = resolve(__dirname, '..', '..');
const readJson = relativePath => JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), 'utf8'));

const rootManifest = readJson('package.json');
const rootLock = readJson('package-lock.json');
const workspaceManifestEntryList = readdirSync(resolve(repositoryRoot, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => `packages/${entry.name}/package.json`)
  .filter(manifestPath => existsSync(resolve(repositoryRoot, manifestPath)))
  .map(manifestPath => [manifestPath, readJson(manifestPath)]);

for (const [manifestPath, workspaceManifest] of workspaceManifestEntryList) {
  const callsEsbuild = Object.values(workspaceManifest.scripts ?? {})
    .some(script => /(?:^|\s)esbuild(?:\s|$)/u.test(script));

  if (callsEsbuild) {
    assert.ok(
      workspaceManifest.devDependencies?.esbuild,
      `${manifestPath} must own the esbuild CLI called by its scripts`,
    );
  }

  const callsTypeScriptCompiler = Object.values(workspaceManifest.scripts ?? {})
    .some(script => /(?:^|\s)tsc(?:\s|$)/u.test(script));

  if (callsTypeScriptCompiler) {
    assert.ok(
      workspaceManifest.devDependencies?.typescript,
      `${manifestPath} must own the TypeScript CLI called by its scripts`,
    );
  }
}

assert.deepEqual(
  Object.keys(rootManifest.dependencies ?? {}),
  [],
  'the root manifest has no runtime implementation and must not own workspace runtime dependencies',
);
for (const dependencyName of ['cross-env', 'esbuild', 'patch-package']) {
  assert.ok(
    rootManifest.devDependencies?.[dependencyName],
    `the root manifest must own ${dependencyName} required by root scripts or build tools`,
  );
}

const rootBuildToolSource = readdirSync(resolve(repositoryRoot, 'build-tools'), { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
  .map(entry => readFileSync(resolve(repositoryRoot, 'build-tools', entry.name), 'utf8'))
  .join('\n');
const rootCallerSource = [
  ...Object.values(rootManifest.scripts ?? {}),
  rootBuildToolSource,
].join('\n');

for (const dependencyName of Object.keys(rootManifest.devDependencies ?? {})) {
  assert.ok(
    rootCallerSource.includes(dependencyName),
    `root development dependency ${dependencyName} must have a root script or build-tool caller`,
  );
}
for (const [manifestPath, workspaceManifest] of workspaceManifestEntryList) {
  assert.deepEqual(
    Object.keys(workspaceManifest.dependencies ?? {}).filter(name => name.startsWith('@types/')),
    [],
    `${manifestPath} type declarations are build-time dependencies, not runtime dependencies`,
  );
}

assert.deepEqual(
  workspaceManifestEntryList
    .filter(([, workspaceManifest]) => workspaceManifest.dependencies?.sqlite3)
    .map(([manifestPath]) => manifestPath),
  ['packages/backend/package.json'],
  'the backend workspace must be the only owner of the native SQLite implementation',
);

const backendRuntimeDependencyLockKeyList = collectRuntimeDependencyLockKeys(rootLock);
assert.equal(
  backendRuntimeDependencyLockKeyList.some(lockKey => /(?:^|\/)node_modules\/@types\//u.test(lockKey)),
  false,
  'the Electron backend runtime must not collect build-time type declarations',
);

console.log('dependency ownership behavior passed');

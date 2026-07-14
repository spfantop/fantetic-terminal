const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  IGNORED_BACKEND_RUNTIME_DEPENDENCY_NAMES,
  collectRuntimeDependencyLockKeys,
  copyBackendRuntimeDependencies,
  resolveDependencyLockKey,
} = require('../build-tools/prepare-runtime');

const rootLockData = require('../../package-lock.json');
const backendPackage = require('../../packages/backend/package.json');
const actualRuntimeDependencyLockKeys = collectRuntimeDependencyLockKeys(rootLockData);

for (const dependencyName of Object.keys(backendPackage.dependencies)) {
  if (IGNORED_BACKEND_RUNTIME_DEPENDENCY_NAMES?.has?.(dependencyName)) continue;
  assert.ok(
    actualRuntimeDependencyLockKeys.some((lockKey) => (
      lockKey === `node_modules/${dependencyName}`
      || lockKey.endsWith(`/node_modules/${dependencyName}`)
    )),
    `Root lock file must include backend runtime dependency: ${dependencyName}`,
  );
}

const lockData = {
  packages: {
    'packages/backend': {
      dependencies: {
        express: '^5.1.0',
        sqlite3: '^5.1.7',
        ssh2: '^1.16.0',
        'express-session': '^1.19.0',
        '@simplewebauthn/server': '^13.1.1',
        '@types/uuid': '^10.0.0',
      },
    },
    'node_modules/express': {
      dependencies: {
        'optional-native-helper': '^1.0.0',
        router: '^2.2.0',
      },
    },
    'node_modules/optional-native-helper': {
      optional: true,
    },
    'node_modules/router': {},
    'node_modules/sqlite3': {
      dependencies: {
        bindings: '^1.5.0',
      },
      optionalDependencies: {
        'node-addon-api': '^7.0.0',
      },
    },
    'node_modules/bindings': {},
    'node_modules/sqlite3/node_modules/node-addon-api': {},
    'node_modules/ssh2': {
      dependencies: {
        asn1: '^0.2.6',
      },
    },
    'node_modules/asn1': {},
    'node_modules/@simplewebauthn/server': {
      dependencies: {
        '@hexagon/base64': '^1.1.28',
      },
    },
    'node_modules/@hexagon/base64': {},
    'node_modules/@types/uuid': {},
    'packages/backend/node_modules/express-session': {
      dependencies: {
        cookie: '~0.7.2',
      },
    },
    'packages/backend/node_modules/cookie': {},
    'node_modules/typescript': {},
    'node_modules/vite': {},
    'node_modules/monaco-editor': {},
  },
};

const dependencyLockKeys = collectRuntimeDependencyLockKeys(lockData);

assert.equal(
  resolveDependencyLockKey(
    'node_modules/sqlite3',
    'node-addon-api',
    lockData.packages,
  ),
  'node_modules/sqlite3/node_modules/node-addon-api',
);
assert.ok(dependencyLockKeys.includes('node_modules/express'));
assert.ok(dependencyLockKeys.includes('node_modules/optional-native-helper'));
assert.ok(dependencyLockKeys.includes('node_modules/router'));
assert.ok(dependencyLockKeys.includes('node_modules/sqlite3'));
assert.ok(dependencyLockKeys.includes('node_modules/sqlite3/node_modules/node-addon-api'));
assert.ok(dependencyLockKeys.includes('node_modules/ssh2'));
assert.ok(dependencyLockKeys.includes('node_modules/@simplewebauthn/server'));
assert.ok(dependencyLockKeys.includes('node_modules/@hexagon/base64'));
assert.ok(dependencyLockKeys.includes('packages/backend/node_modules/express-session'));
assert.ok(dependencyLockKeys.includes('packages/backend/node_modules/cookie'));

assert.equal(dependencyLockKeys.includes('node_modules/@types/uuid'), false);
assert.equal(dependencyLockKeys.includes('node_modules/typescript'), false);
assert.equal(dependencyLockKeys.includes('node_modules/vite'), false);
assert.equal(dependencyLockKeys.includes('node_modules/monaco-editor'), false);

for (const lockKey of dependencyLockKeys) {
  assert.ok(
    lockKey.startsWith('node_modules/') || lockKey.startsWith('packages/backend/node_modules/'),
    `Runtime dependency should be copied under backend node_modules: ${lockKey}`,
  );
  assert.equal(path.isAbsolute(lockKey), false);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-runtime-test-'));
try {
  const lockFilePath = path.join(tmpDir, 'package-lock.json');
  const sourceNodeModulesDir = path.join(tmpDir, 'node_modules');
  const targetNodeModulesDir = path.join(tmpDir, 'runtime-node_modules');
  const copiedPackagePaths = [
    'express',
    'router',
    'sqlite3',
    path.join('sqlite3', 'node_modules', 'node-addon-api'),
    'bindings',
    'ssh2',
    'asn1',
    path.join('@simplewebauthn', 'server'),
    path.join('@hexagon', 'base64'),
  ];
  const copiedWorkspacePackagePaths = [
    path.join('packages', 'backend', 'node_modules', 'express-session'),
    path.join('packages', 'backend', 'node_modules', 'cookie'),
  ];

  fs.writeFileSync(lockFilePath, JSON.stringify(lockData), 'utf8');
  for (const packagePath of copiedPackagePaths) {
    const packageDir = path.join(sourceNodeModulesDir, packagePath);
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), '{}', 'utf8');
  }
  for (const packagePath of copiedWorkspacePackagePaths) {
    const packageDir = path.join(tmpDir, packagePath);
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), '{}', 'utf8');
  }

  copyBackendRuntimeDependencies({
    lockFilePath,
    sourceNodeModulesDir,
    targetNodeModulesDir,
  });

  assert.equal(fs.existsSync(path.join(targetNodeModulesDir, 'express')), true);
  assert.equal(fs.existsSync(path.join(targetNodeModulesDir, '@hexagon', 'base64')), true);
  assert.equal(fs.existsSync(path.join(targetNodeModulesDir, 'router')), true);
  assert.equal(fs.existsSync(path.join(targetNodeModulesDir, 'optional-native-helper')), false);
  assert.equal(fs.existsSync(path.join(targetNodeModulesDir, 'express-session')), true);
  assert.equal(fs.existsSync(path.join(targetNodeModulesDir, 'cookie')), true);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('prepare-runtime dependency selection behavior passed');

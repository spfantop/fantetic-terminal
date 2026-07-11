const fs = require('node:fs');
const path = require('node:path');

const appDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(appDir, '..');
const runtimeDir = path.join(appDir, 'runtime');
const runtimePackagesDir = path.join(runtimeDir, 'packages');
const runtimeBackendDir = path.join(runtimePackagesDir, 'backend');
const runtimeFrontendDir = path.join(runtimePackagesDir, 'frontend');
const runtimeBackendNodeModulesDir = path.join(runtimeBackendDir, 'node_modules');

const BACKEND_LOCK_KEY = 'packages/backend';
const IGNORED_BACKEND_RUNTIME_DEPENDENCY_NAMES = new Set([
  '@types/archiver',
  '@types/multer',
  '@types/session-file-store',
  '@types/uuid',
]);

const toPathParts = (packageName) => packageName.split('/');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const assertInsideDirectory = (targetPath, parentPath) => {
  const resolvedTargetPath = path.resolve(targetPath);
  const resolvedParentPath = path.resolve(parentPath);
  const relativePath = path.relative(resolvedParentPath, resolvedTargetPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Refusing to write outside ${resolvedParentPath}: ${resolvedTargetPath}`);
  }
};

const removeDirectory = (targetPath, parentPath) => {
  assertInsideDirectory(targetPath, parentPath);
  fs.rmSync(targetPath, { recursive: true, force: true });
};

const copyDirectory = (sourcePath, targetPath) => {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Required path does not exist: ${sourcePath}`);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true, dereference: true });
};

const resolveDependencyLockKey = (fromLockKey, dependencyName, packages) => {
  const dependencyParts = toPathParts(dependencyName);
  const searchParts = fromLockKey === BACKEND_LOCK_KEY
    ? ['packages', 'backend']
    : fromLockKey.split('/');

  for (let index = searchParts.length; index >= 0; index -= 1) {
    const candidateParts = [
      ...searchParts.slice(0, index),
      'node_modules',
      ...dependencyParts,
    ];
    const candidateKey = candidateParts.join('/');

    if (packages[candidateKey]) {
      return candidateKey;
    }
  }

  return null;
};

const listRuntimeDependencyNames = (packageEntry) => {
  const dependencies = packageEntry.dependencies ?? {};
  const optionalDependencies = packageEntry.optionalDependencies ?? {};

  return Object.keys({
    ...dependencies,
    ...optionalDependencies,
  }).filter((dependencyName) => (
    !IGNORED_BACKEND_RUNTIME_DEPENDENCY_NAMES.has(dependencyName)
  ));
};

const collectRuntimeDependencyLockKeys = (lockData) => {
  const packages = lockData.packages ?? {};
  const backendEntry = packages[BACKEND_LOCK_KEY];

  if (!backendEntry) {
    throw new Error(`Missing ${BACKEND_LOCK_KEY} entry in package-lock.json`);
  }

  const visitedLockKeys = new Set();
  const queue = listRuntimeDependencyNames(backendEntry)
    .map((dependencyName) => resolveDependencyLockKey(BACKEND_LOCK_KEY, dependencyName, packages));

  while (queue.length > 0) {
    const lockKey = queue.shift();

    if (!lockKey || visitedLockKeys.has(lockKey)) {
      continue;
    }

    const packageEntry = packages[lockKey];
    if (!packageEntry) {
      throw new Error(`Missing package-lock entry for ${lockKey}`);
    }

    visitedLockKeys.add(lockKey);

    for (const dependencyName of listRuntimeDependencyNames(packageEntry)) {
      queue.push(resolveDependencyLockKey(lockKey, dependencyName, packages));
    }
  }

  return [...visitedLockKeys].sort();
};

const copyBackendRuntimeDependencies = ({
  lockFilePath = path.join(rootDir, 'package-lock.json'),
  sourceNodeModulesDir = path.join(rootDir, 'node_modules'),
  targetNodeModulesDir = runtimeBackendNodeModulesDir,
} = {}) => {
  const lockData = readJson(lockFilePath);
  const dependencyLockKeys = collectRuntimeDependencyLockKeys(lockData);
  const packages = lockData.packages ?? {};

  for (const lockKey of dependencyLockKeys) {
    if (!lockKey.startsWith('node_modules/')) {
      continue;
    }

    const relativePackagePath = lockKey.slice('node_modules/'.length);
    const sourcePath = path.join(sourceNodeModulesDir, relativePackagePath);
    const targetPath = path.join(targetNodeModulesDir, relativePackagePath);
    const packageEntry = packages[lockKey] ?? {};

    if (!fs.existsSync(sourcePath) && packageEntry.optional) {
      continue;
    }

    copyDirectory(sourcePath, targetPath);
  }

  return dependencyLockKeys;
};

const prepareRuntime = ({
  rootPath = rootDir,
  appPath = appDir,
  runtimePath = runtimeDir,
} = {}) => {
  const backendDistPath = path.join(rootPath, 'packages/backend/dist');
  const frontendDistPath = path.join(rootPath, 'packages/frontend/dist');
  const backendPackageJsonPath = path.join(rootPath, 'packages/backend/package.json');
  const targetPackagesPath = path.join(runtimePath, 'packages');
  const targetBackendPath = path.join(targetPackagesPath, 'backend');
  const targetFrontendPath = path.join(targetPackagesPath, 'frontend');

  removeDirectory(runtimePath, appPath);
  fs.mkdirSync(runtimePath, { recursive: true });

  copyDirectory(backendDistPath, path.join(targetBackendPath, 'dist'));
  copyDirectory(backendPackageJsonPath, path.join(targetBackendPath, 'package.json'));
  copyDirectory(frontendDistPath, path.join(targetFrontendPath, 'dist'));

  const dependencyLockKeys = copyBackendRuntimeDependencies({
    lockFilePath: path.join(rootPath, 'package-lock.json'),
    sourceNodeModulesDir: path.join(rootPath, 'node_modules'),
    targetNodeModulesDir: path.join(targetBackendPath, 'node_modules'),
  });

  return {
    runtimePath,
    dependencyCount: dependencyLockKeys.length,
  };
};

if (require.main === module) {
  const result = prepareRuntime();
  console.log(`Prepared Electron runtime at ${result.runtimePath}`);
  console.log(`Copied ${result.dependencyCount} backend runtime dependencies`);
}

module.exports = {
  BACKEND_LOCK_KEY,
  IGNORED_BACKEND_RUNTIME_DEPENDENCY_NAMES,
  collectRuntimeDependencyLockKeys,
  copyBackendRuntimeDependencies,
  prepareRuntime,
  resolveDependencyLockKey,
};

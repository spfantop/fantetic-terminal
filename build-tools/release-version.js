const fs = require('node:fs');
const path = require('node:path');

const SEMANTIC_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const normalizeReleaseReference = (releaseReference) => (
  String(releaseReference ?? '').trim().replace(/^v/, '')
);

const validateProjectReleaseVersion = ({
  packageVersion,
  electronVersion,
  releaseReference = '',
  stableOnly = false,
  requireTagPrefix = false,
}) => {
  const version = String(packageVersion ?? '').trim();
  const versionPattern = stableOnly ? STABLE_VERSION_PATTERN : SEMANTIC_VERSION_PATTERN;
  if (!versionPattern.test(version)) {
    throw new Error(`Invalid root package version: ${String(packageVersion)}`);
  }
  if (electronVersion !== version) {
    throw new Error(`Electron version ${electronVersion} does not match root version ${version}`);
  }

  const normalizedReference = normalizeReleaseReference(releaseReference);
  if (releaseReference && requireTagPrefix && releaseReference !== `v${normalizedReference}`) {
    throw new Error(`Release tag ${releaseReference} must match package version v${version}`);
  }
  if (releaseReference && normalizedReference !== version) {
    const label = requireTagPrefix ? 'tag' : 'version';
    const expectedVersion = requireTagPrefix ? `v${version}` : version;
    throw new Error(`Release ${label} ${releaseReference} must match package version ${expectedVersion}`);
  }
  return version;
};

const readProjectVersionSet = (rootDirectory) => {
  const readManifest = relativePath => JSON.parse(
    fs.readFileSync(path.join(rootDirectory, relativePath), 'utf8'),
  );
  return {
    packageVersion: readManifest('package.json').version,
    electronVersion: readManifest('electron-app/package.json').version,
  };
};

module.exports = {
  normalizeReleaseReference,
  readProjectVersionSet,
  validateProjectReleaseVersion,
};

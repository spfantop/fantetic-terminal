import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const versionRoutes = readFileSync(resolve('src/version/version.routes.ts'), 'utf8');

assert.match(
  versionRoutes,
  /readLatestReleaseVersion/,
  'version remote endpoint should prefer GitHub releases because raw VERSION can be unavailable in some deployments',
);

assert.match(
  versionRoutes,
  /readPackageVersion/,
  'version remote endpoint should fall back to the repository package version when no release exists',
);

assert.match(versionRoutes, /raw\.githubusercontent\.com\/\$\{GITHUB_REPO\}\/main\/package\.json/, 'version fallback should use the root package metadata, which is the release version source');
assert.doesNotMatch(versionRoutes, /main\/VERSION/, 'version fallback must not reference a VERSION file that is absent from the repository root');

assert.match(
  versionRoutes,
  /const releaseVersion = await readLatestReleaseVersion\(\);[\s\S]*if \(releaseVersion\) \{[\s\S]*version: releaseVersion/s,
  'version remote endpoint should return the latest release tag before falling back to VERSION',
);

assert.match(
  versionRoutes,
  /const packageVersion = await readPackageVersion\(\);[\s\S]*if \(packageVersion\) \{[\s\S]*version: packageVersion/s,
  'version remote endpoint should return the repository package version when no release tag is available',
);

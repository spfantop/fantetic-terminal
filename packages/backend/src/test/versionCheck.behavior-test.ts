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
  /readVersionFileVersion/,
  'version remote endpoint should keep VERSION file fallback for repositories without releases',
);

assert.match(
  versionRoutes,
  /const releaseVersion = await readLatestReleaseVersion\(\);[\s\S]*if \(releaseVersion\) \{[\s\S]*version: releaseVersion/s,
  'version remote endpoint should return the latest release tag before falling back to VERSION',
);

assert.match(
  versionRoutes,
  /const versionFileVersion = await readVersionFileVersion\(\);[\s\S]*if \(versionFileVersion\) \{[\s\S]*version: versionFileVersion/s,
  'version remote endpoint should return VERSION content when no release tag is available',
);

const path = require('node:path');
const {
  readProjectVersionSet,
  validateProjectReleaseVersion,
} = require('./release-version');

const rootDir = path.resolve(__dirname, '..');
const versionSet = readProjectVersionSet(rootDir);
const releaseTag = String(process.env.RELEASE_TAG ?? '').trim();
const version = validateProjectReleaseVersion({
  ...versionSet,
  releaseReference: releaseTag,
  requireTagPrefix: true,
});

console.log(`Validated release version ${version}${releaseTag ? ` for ${releaseTag}` : ''}`);

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const electronPackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'electron-app/package.json'), 'utf8'));
const version = String(rootPackage.version ?? '').trim();
const releaseTag = String(process.env.RELEASE_TAG ?? '').trim();

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid root package version: ${String(rootPackage.version)}`);
}

if (electronPackage.version !== version) {
  throw new Error(`Electron version ${electronPackage.version} does not match root version ${version}`);
}

if (releaseTag && releaseTag !== `v${version}`) {
  throw new Error(`Release tag ${releaseTag} must match package version v${version}`);
}

console.log(`Validated release version ${version}${releaseTag ? ` for ${releaseTag}` : ''}`);

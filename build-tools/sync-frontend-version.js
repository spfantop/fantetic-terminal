const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const rootPackagePath = path.join(rootDir, 'package.json');
const versionFilePath = path.join(rootDir, 'packages', 'frontend', 'public', 'VERSION');
const electronPackagePath = path.join(rootDir, 'electron-app', 'package.json');
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
const version = typeof rootPackage.version === 'string' ? rootPackage.version.trim() : '';

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid root package version: ${String(rootPackage.version)}`);
}

fs.writeFileSync(versionFilePath, `${version}\n`, 'utf8');
if (fs.existsSync(electronPackagePath)) {
  const electronPackage = JSON.parse(fs.readFileSync(electronPackagePath, 'utf8'));
  electronPackage.version = version;
  fs.writeFileSync(electronPackagePath, `${JSON.stringify(electronPackage, null, 2)}\n`, 'utf8');
}
console.log(`Synchronized frontend VERSION to ${version}`);

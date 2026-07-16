const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const compose = read('docker-compose.yml');
const desktopWorkflow = read('.github/workflows/desktop-build.yml');
const qualityWorkflow = read('.github/workflows/quality.yml');
const securityWorkflow = read('.github/workflows/security.yml');
const readme = read('README.md');
const license = read('LICENSE');
const rootPackage = JSON.parse(read('package.json'));
const electronPackage = JSON.parse(read('electron-app/package.json'));
const gatewayPackage = JSON.parse(read('packages/remote-gateway/package.json'));
const gatewayDockerfile = read('packages/remote-gateway/Dockerfile');
const armCompose = read('doc/arm/docker-compose.yml');

assert.doesNotMatch(compose, /^\s*image:\s*[^\n]+:latest\s*$/m);
assert.doesNotMatch(armCompose, /^\s*#?\s*image:\s*[^\n]+:latest\s*$/m);
assert.doesNotMatch(readme, /guacamole\/guacd:latest/);
for (const image of ['frontend', 'backend', 'remote-gateway']) {
  assert.match(compose, new RegExp(`image: spfantop/fantetic-terminal-${image}:${rootPackage.version}`));
}
assert.equal((compose.match(/^\s*restart:\s*unless-stopped\s*$/gm) || []).length, 3);
assert.equal((compose.match(/^\s*- no-new-privileges:true\s*$/gm) || []).length, 3);
assert.match(compose, /backend:\s*\n\s*condition: service_healthy/);
assert.match(compose, /remote-gateway:\s*\n\s*condition: service_healthy/);

assert.equal(rootPackage.license, 'GPL-3.0-only');
assert.equal(electronPackage.license, 'GPL-3.0-only');
assert.equal(gatewayPackage.license, 'GPL-3.0-only');
assert.match(license, /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
assert.match(readme, /Lockfile-based frontend\/backend\/desktop builds/);
assert.match(readme, /pins all three application images to the same release version/);

assert.match(qualityWorkflow, /npm audit --audit-level=high/);
assert.match(qualityWorkflow, /npm audit --prefix electron-app --package-lock-only --audit-level=high/);
assert.match(rootPackage.scripts['test:delivery'], /security-scan/);
assert.match(desktopWorkflow, /name: Verify release checksums[\s\S]*sha256sum --check SHA256SUMS\.txt/);
assert.match(gatewayDockerfile, /FROM guacamole\/guacd:1\.6\.0@sha256:8974eaa9ba32f713daf311e7cc8cd7e4cdfba1edea39eed75524e78ef4b08f4f/);
assert.match(securityWorkflow, /node build-tools\/security-scan\.js/);
assert.match(securityWorkflow, /npm sbom --sbom-format cyclonedx --omit=dev/);
assert.match(securityWorkflow, /aquasecurity\/trivy-action@[a-f0-9]{40}\s+# v0\.33\.1/);
assert.match(securityWorkflow, /github\/codeql-action\/init@[a-f0-9]{40}\s+# v3/);
for (const workflow of [qualityWorkflow, desktopWorkflow, securityWorkflow]) {
  assert.doesNotMatch(workflow, /uses:\s*[^\s@]+@v\d+/);
  assert.match(workflow, /uses:\s*[^\s@]+@[a-f0-9]{40}\s+# v\d+/);
}

console.log('Supply-chain delivery behavior checks passed');

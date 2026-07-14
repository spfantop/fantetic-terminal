const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const workflow = read('.github/workflows/desktop-build.yml');
const frontendDockerfile = read('packages/frontend/Dockerfile');
const backendDockerfile = read('packages/backend/Dockerfile');
const gatewayDockerfile = read('packages/remote-gateway/Dockerfile');
const qualityWorkflow = read('.github/workflows/quality.yml');
const releaseGuide = read('docs/RELEASE.md');

assert.match(
  workflow,
  /VITE_FANTETIC_APP_MODE:\s*electron/,
  'Desktop builds must compile the frontend with Electron runtime capabilities',
);
assert.match(workflow, /Validate release version/);
assert.match(workflow, /build:windows/);
assert.match(workflow, /build:linux/);
assert.match(workflow, /build:macos:x64/);
assert.match(workflow, /build:macos:arm64/);
assert.match(workflow, /release-assets\/SHA256SUMS\.txt/);
assert.match(workflow, /SIGNING_CSC_LINK:/);
assert.match(workflow, /if \(\$env:SIGNING_CSC_LINK\)/);
assert.doesNotMatch(workflow, /^\s*CSC_LINK:\s*\$\{\{[^\n]*\|\|\s*''/m);

assert.doesNotMatch(frontendDockerfile, /COPY\s+\.env\s/);
assert.match(frontendDockerfile, /RUN npm ci/);
assert.doesNotMatch(frontendDockerfile, /RUN npm install/);
assert.match(backendDockerfile, /RUN npm ci/);
assert.doesNotMatch(backendDockerfile, /RUN npm install/);
assert.match(backendDockerfile, /COPY packages\/contracts\/package\.json \.\/packages\/contracts\//);
assert.match(backendDockerfile, /COPY packages\/contracts\/index\.d\.ts \.\/packages\/contracts\//);
assert.match(backendDockerfile, /HEALTHCHECK/);
assert.match(frontendDockerfile, /HEALTHCHECK/);
assert.match(gatewayDockerfile, /COPY package\.json package-lock\.json/);
assert.match(gatewayDockerfile, /RUN npm ci/);
assert.doesNotMatch(gatewayDockerfile, /RUN npm install/);

assert.match(qualityWorkflow, /pull_request:/);
assert.match(qualityWorkflow, /npm run test:delivery/);
assert.match(qualityWorkflow, /npm run build --workspace=@fantetic-terminal\/backend/);
assert.match(qualityWorkflow, /npm run build --workspace=@fantetic-terminal\/frontend/);
assert.match(qualityWorkflow, /npm run build --workspace=@fantetic-terminal\/remote-gateway/);

assert.match(releaseGuide, /Release Assets/);
assert.match(releaseGuide, /v\$\{version\}/);

console.log('Delivery pipeline behavior checks passed');

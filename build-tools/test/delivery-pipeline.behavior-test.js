const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const workflow = read('.github/workflows/desktop-build.yml');
const frontendDockerfile = read('packages/frontend/Dockerfile');
const backendDockerfile = read('packages/backend/Dockerfile');

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

assert.doesNotMatch(frontendDockerfile, /COPY\s+\.env\s/);
assert.match(frontendDockerfile, /RUN npm ci/);
assert.doesNotMatch(frontendDockerfile, /RUN npm install/);
assert.match(backendDockerfile, /RUN npm ci/);
assert.doesNotMatch(backendDockerfile, /RUN npm install/);

console.log('Delivery pipeline behavior checks passed');

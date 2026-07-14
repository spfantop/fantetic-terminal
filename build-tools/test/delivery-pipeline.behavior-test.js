const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const workflow = read('.github/workflows/desktop-build.yml');
const frontendDockerfile = read('packages/frontend/Dockerfile');
const backendDockerfile = read('packages/backend/Dockerfile');
const gatewayDockerfile = read('packages/remote-gateway/Dockerfile');
const gatewayEntrypoint = read('packages/remote-gateway/entrypoint.sh');
const frontendNginxConfig = read('packages/frontend/nginx.conf');
const qualityWorkflow = read('.github/workflows/quality.yml');
const releaseGuide = read('docs/RELEASE.md');
const dockerCompose = read('docker-compose.yml');
const electronPackage = JSON.parse(read('electron-app/package.json'));

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
assert.match(workflow, /Validate Electron packaging behavior/);
assert.match(workflow, /release-assets\/SHA256SUMS\.txt/);
assert.match(workflow, /SIGNING_CSC_LINK:/);
assert.match(workflow, /if \(\$env:SIGNING_CSC_LINK\)/);
assert.doesNotMatch(workflow, /^\s*CSC_LINK:\s*\$\{\{[^\n]*\|\|\s*''/m);

assert.doesNotMatch(frontendDockerfile, /COPY\s+\.env\s/);
assert.match(frontendDockerfile, /RUN npm ci/);
assert.doesNotMatch(frontendDockerfile, /RUN npm install/);
assert.match(frontendDockerfile, /COPY build-tools\/apply-patches\.js \.\/build-tools\//);
assert.match(frontendDockerfile, /COPY packages\/remote-gateway\/patches \.\/packages\/remote-gateway\/patches/);
assert.match(frontendDockerfile, /COPY packages\/contracts\/package\.json \.\/packages\/contracts\//);
assert.match(frontendDockerfile, /COPY packages\/contracts\/index\.d\.ts \.\/packages\/contracts\//);
assert.match(backendDockerfile, /RUN npm ci/);
assert.doesNotMatch(backendDockerfile, /RUN npm install/);
assert.match(backendDockerfile, /COPY packages\/contracts\/package\.json \.\/packages\/contracts\//);
assert.match(backendDockerfile, /COPY packages\/contracts\/index\.d\.ts \.\/packages\/contracts\//);
assert.match(backendDockerfile, /COPY build-tools\/apply-patches\.js \.\/build-tools\//);
assert.match(backendDockerfile, /COPY packages\/remote-gateway\/patches \.\/packages\/remote-gateway\/patches/);
assert.match(backendDockerfile, /COPY --from=builder \/app\/packages\/backend\/dist \.\/packages\/backend\/dist/);
assert.match(backendDockerfile, /CMD \["node", "packages\/backend\/dist\/index\.js"\]/);
assert.match(backendDockerfile, /HEALTHCHECK/);
assert.match(frontendDockerfile, /HEALTHCHECK/);
assert.match(gatewayDockerfile, /COPY package\.json package-lock\.json/);
assert.match(gatewayDockerfile, /RUN npm ci/);
assert.match(gatewayDockerfile, /COPY --from=builder \/app\/packages\/remote-gateway\/node_modules \.\/node_modules/);
assert.doesNotMatch(gatewayDockerfile, /RUN npm install/);
assert.match(gatewayDockerfile, /COPY build-tools\/apply-patches\.js \.\/build-tools\//);
assert.match(gatewayDockerfile, /COPY packages\/remote-gateway\/patches \.\/packages\/remote-gateway\/patches/);
assert.doesNotMatch(gatewayDockerfile, /COPY patches \.\/patches/);
assert.match(gatewayDockerfile, /apk add --no-cache nodejs curl bash netcat-openbsd su-exec/);
assert.doesNotMatch(gatewayDockerfile, /USER guacd/);

assert.match(qualityWorkflow, /pull_request:/);
assert.match(qualityWorkflow, /npm run test:delivery/);
assert.match(qualityWorkflow, /npm run build --workspace=@fantetic-terminal\/backend/);
assert.match(qualityWorkflow, /npm run build --workspace=@fantetic-terminal\/frontend/);
assert.match(qualityWorkflow, /npm run build --workspace=@fantetic-terminal\/remote-gateway/);
assert.match(qualityWorkflow, /npm run test:guacamole-lite-patch --workspace=@fantetic-terminal\/remote-gateway/);

assert.match(releaseGuide, /Release Assets/);
assert.match(releaseGuide, /v\$\{version\}/);
assert.match(releaseGuide, /-portable\.zip/);
assert.deepEqual(electronPackage.build.win.target, ['nsis', 'zip']);
assert.match(workflow, /electron-app\/dist_electron\/\*\.zip/);
assert.match(workflow, /release-assets\/\*\.zip/);
assert.match(electronPackage.scripts['build:windows'], /electron-builder --win --x64/);
assert.ok(electronPackage.build.files.includes('service-readiness.js'));
assert.doesNotMatch(dockerCompose, /:\?Set (ENCRYPTION_KEY|SESSION_SECRET|REMOTE_GATEWAY_SHARED_SECRET)/);
assert.match(dockerCompose, /APP_BACKEND_DATA_PATH: \/app\/data/);
assert.match(dockerCompose, /\.\/data:\/app\/data:ro/);
assert.match(gatewayEntrypoint, /Waiting for Docker runtime secrets/);
assert.match(gatewayEntrypoint, /id -u/);
assert.match(gatewayEntrypoint, /exec su-exec guacd "\$0" --run/);
assert.match(frontendNginxConfig, /resolver\s+127\.0\.0\.11\s+ipv6=off/);
assert.match(frontendNginxConfig, /set\s+\$backend_upstream\s+http:\/\/backend:3001/);
assert.match(frontendNginxConfig, /proxy_pass\s+\$backend_upstream/);

console.log('Delivery pipeline behavior checks passed');

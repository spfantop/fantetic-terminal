const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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
const singleImageDockerfile = read('packages/single-image/Dockerfile');
const singleImageSupervisor = read('packages/single-image/supervisor.js');
const singleImageNginxConfig = read('packages/single-image/nginx.conf');
const qualityWorkflow = read('.github/workflows/quality.yml');
const dockerPublishWorkflow = read('.github/workflows/docker-publish.yml');
const securityWorkflow = read('.github/workflows/security.yml');
const releaseGuide = read('docs/RELEASE.md');
const dockerPublishGuide = read('docs/DOCKER_IMAGE_PUBLISH.md');
const dockerCompose = read('docker-compose.yml');
const electronPackage = JSON.parse(read('electron-app/package.json'));
const rootPackage = JSON.parse(read('package.json'));

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
assert.match(workflow, /cd release-assets[\s\S]*! -name SHA256SUMS\.txt/);
assert.doesNotMatch(workflow, /find release-assets -maxdepth 1 -type f -print0[\s\S]*> release-assets\/SHA256SUMS\.txt/);
assert.match(workflow, /SIGNING_CSC_LINK:/);
assert.match(workflow, /if \(\$env:SIGNING_CSC_LINK -and \$env:SIGNING_CSC_KEY_PASSWORD\)/);
assert.match(workflow, /Report optional signing and notarization configuration/);
assert.match(workflow, /APPLE_API_KEY:/);
assert.match(workflow, /APPLE_API_KEY_ID:/);
assert.match(workflow, /APPLE_API_ISSUER:/);
assert.match(workflow, /APPLE_TEAM_ID:/);
assert.doesNotMatch(workflow, /Production desktop releases require platform signing credentials/);
assert.doesNotMatch(workflow, /^\s*CSC_LINK:\s*\$\{\{[^\n]*\|\|\s*''/m);
assert.match(dockerPublishWorkflow, /tags:\s*\n\s*- 'v\*'/);
assert.doesNotMatch(
  dockerPublishWorkflow,
  /branches:\s*\[main\]/,
  'Docker images must only be published for release tags or explicit manual runs',
);
assert.match(dockerPublishWorkflow, /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*version:/);
assert.match(dockerPublishWorkflow, /Release version must use semantic versioning/);
assert.match(dockerPublishWorkflow, /DOCKERHUB_USERNAME/);
assert.match(dockerPublishWorkflow, /DOCKERHUB_TOKEN/);
assert.match(dockerPublishWorkflow, /linux\/amd64,linux\/arm64/);
assert.match(dockerPublishWorkflow, /image:\s*frontend/);
assert.match(dockerPublishWorkflow, /image:\s*backend/);
assert.match(dockerPublishWorkflow, /image:\s*remote-gateway/);
assert.match(dockerPublishWorkflow, /name:\s*All-in-one/);
assert.match(dockerPublishWorkflow, /repository:\s*fantetic-terminal/);
assert.match(dockerPublishWorkflow, /dockerfile:\s*packages\/single-image\/Dockerfile/);
assert.match(dockerPublishWorkflow, /\$\{\{ secrets\.DOCKERHUB_USERNAME \}\}\/\$\{\{ matrix\.repository \}\}/);
assert.match(dockerPublishWorkflow, /IMAGE_NAME: \$\{\{ matrix\.repository \}\}/);
assert.match(dockerPublishWorkflow, /type=semver,pattern=\{\{version\}\}/);
assert.match(dockerPublishWorkflow, /type=raw,value=latest/);
assert.doesNotMatch(dockerPublishWorkflow, /type=ref,event=branch/);
assert.doesNotMatch(dockerPublishWorkflow, /type=semver,pattern=\{\{major\}\}/);
assert.doesNotMatch(dockerPublishWorkflow, /type=sha,prefix=sha-/);
assert.doesNotMatch(dockerPublishWorkflow, /value=latest,enable=/);
assert.match(dockerPublishWorkflow, /name: Remove obsolete Docker Hub tags/);
assert.match(dockerPublishWorkflow, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
assert.match(
  dockerPublishWorkflow,
  /RELEASE_VERSION: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.version \|\| github\.ref_name \}\}/,
);
assert.match(dockerPublishWorkflow, /https:\/\/hub\.docker\.com\/v2\/auth\/token/);
assert.match(dockerPublishWorkflow, /\{identifier: \$identifier, secret: \$secret\}/);
assert.match(dockerPublishWorkflow, /\.access_token \/\/ empty/);
assert.doesNotMatch(dockerPublishWorkflow, /v2\/users\/login/);
assert.match(dockerPublishWorkflow, /tags_api_url="https:\/\/hub\.docker\.com\/v2\/namespaces\/\$DOCKERHUB_USERNAME\/repositories\/\$IMAGE_NAME\/tags"/);
assert.match(dockerPublishWorkflow, /"\$tags_api_url\?page_size=100"/);
assert.match(dockerPublishWorkflow, /"\$tags_api_url\/\$tag"/);
assert.match(dockerPublishWorkflow, /\[ "\$tag" = "\$release_version" \] \|\| \[ "\$tag" = 'latest' \]/);
assert.match(dockerPublishGuide, /DOCKERHUB_USERNAME/);
assert.match(dockerPublishGuide, /DOCKERHUB_TOKEN/);

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
assert.match(backendDockerfile, /^FROM node:20-bookworm-slim$/m);
assert.match(
  backendDockerfile,
  /RUN apt-get update(?:(?!\r?\nRUN )[\s\S])*apt-get upgrade -y(?:(?!\r?\nRUN )[\s\S])*apt-get install -y --no-install-recommends gosu python3 make g\+\+(?:(?!\r?\nRUN )[\s\S])*npm ci --omit=dev --workspace=@fantetic-terminal\/backend(?:(?!\r?\nRUN )[\s\S])*npm cache clean --force(?:(?!\r?\nRUN )[\s\S])*apt-get purge -y --auto-remove python3 make g\+\+/,
  'Backend build dependencies must be installed and removed in the same layer so compilers do not remain in the published image',
);
assert.match(backendDockerfile, /CMD \["node", "packages\/backend\/dist\/index\.js"\]/);
assert.match(backendDockerfile, /ENTRYPOINT \["\/entrypoint\.sh"\]/);
assert.match(backendDockerfile, /apt-get upgrade -y/);
assert.match(backendDockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/npm/);
assert.match(read('packages\/backend\/entrypoint\.sh'), /exec gosu node/);
assert.match(backendDockerfile, /HEALTHCHECK/);
assert.match(frontendDockerfile, /HEALTHCHECK/);
assert.match(backendDockerfile, /HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3/);
assert.match(frontendDockerfile, /HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3/);
assert.match(gatewayDockerfile, /COPY package\.json package-lock\.json/);
assert.match(gatewayDockerfile, /RUN npm ci/);
assert.match(gatewayDockerfile, /FROM node:20 AS production-dependencies/);
assert.match(gatewayDockerfile, /FROM node:20-alpine AS node-runtime/);
assert.match(gatewayDockerfile, /RUN npm ci --omit=dev --workspace=@fantetic-terminal\/remote-gateway/);
assert.match(gatewayDockerfile, /COPY --from=production-dependencies \/app\/node_modules \.\/node_modules/);
assert.match(gatewayDockerfile, /COPY --from=production-dependencies \/app\/packages\/remote-gateway\/node_modules \.\/node_modules/);
assert.doesNotMatch(gatewayDockerfile, /COPY --from=builder \/app\/node_modules \.\/node_modules/);
assert.doesNotMatch(gatewayDockerfile, /RUN npm install/);
assert.match(gatewayDockerfile, /COPY --from=builder \/app\/packages\/remote-gateway\/node_modules\/guacamole-lite \.\/node_modules\/guacamole-lite/);
assert.match(gatewayDockerfile, /COPY build-tools\/apply-patches\.js \.\/build-tools\//);
assert.match(gatewayDockerfile, /COPY packages\/remote-gateway\/patches \.\/packages\/remote-gateway\/patches/);
assert.doesNotMatch(gatewayDockerfile, /COPY patches \.\/patches/);
assert.match(gatewayDockerfile, /apk add --no-cache curl bash netcat-openbsd su-exec/);
assert.doesNotMatch(gatewayDockerfile, /USER guacd/);
assert.match(gatewayDockerfile, /COPY --from=node-runtime \/usr\/local\/bin\/node \/usr\/local\/bin\/node/);
assert.doesNotMatch(gatewayDockerfile, /apk add --no-cache nodejs/);
assert.match(gatewayDockerfile, /rm -rf \.\/node_modules\/esbuild \.\/node_modules\/@esbuild/);
assert.match(gatewayDockerfile, /rm -f \.\/node_modules\/\.bin\/esbuild/);
assert.match(gatewayDockerfile, /HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3/);

assert.match(qualityWorkflow, /pull_request:/);
assert.match(qualityWorkflow, /Run full behavior suite/);
assert.match(qualityWorkflow, /run: npm test/);
assert.match(qualityWorkflow, /npm audit --audit-level=high/);
assert.match(qualityWorkflow, /npm audit --prefix electron-app --package-lock-only --audit-level=high/);
assert.match(rootPackage.scripts.test, /workspace-test-suite\.behavior-test\.js/);
assert.match(rootPackage.scripts.test, /workspace-test-suite\.js/);
assert.match(qualityWorkflow, /npm run build --workspace=@fantetic-terminal\/backend/);
assert.match(qualityWorkflow, /npm run build --workspace=@fantetic-terminal\/frontend/);
assert.match(qualityWorkflow, /npm run build --workspace=@fantetic-terminal\/remote-gateway/);
assert.doesNotMatch(qualityWorkflow, /test:guacamole-lite-patch/);
assert.match(rootPackage.scripts.test, /workspace-test-suite/);

assert.match(releaseGuide, /Release Assets/);
assert.match(releaseGuide, /v\$\{version\}/);
assert.match(releaseGuide, /-portable\.zip/);
assert.deepEqual(electronPackage.build.win.target, ['nsis', 'zip']);
assert.match(workflow, /electron-app\/dist_electron\/\*\.zip/);
assert.match(workflow, /release-assets\/\*\.zip/);
assert.match(electronPackage.scripts['build:windows'], /electron-builder --win --x64/);
assert.ok(electronPackage.build.files.includes('service-readiness.js'));
assert.equal(electronPackage.build.mac.notarize, true);
assert.equal(electronPackage.build.mac.hardenedRuntime, true);
assert.doesNotMatch(dockerCompose, /:\?Set (ENCRYPTION_KEY|SESSION_SECRET|REMOTE_GATEWAY_SHARED_SECRET)/);
assert.match(dockerCompose, /APP_BACKEND_DATA_PATH: \/app\/data/);
assert.match(dockerCompose, /RECORDING_RETENTION_DAYS: "\$\{RECORDING_RETENTION_DAYS:-0\}"/);
assert.match(dockerCompose, /RECORDING_MAX_TOTAL_BYTES: "\$\{RECORDING_MAX_TOTAL_BYTES:-0\}"/);
assert.match(dockerCompose, /RECORDING_MIN_FREE_BYTES: "\$\{RECORDING_MIN_FREE_BYTES:-536870912\}"/);
assert.match(dockerCompose, /HEALTH_MIN_FREE_BYTES: "\$\{HEALTH_MIN_FREE_BYTES:-104857600\}"/);
assert.match(dockerCompose, /METRICS_TOKEN: "\$\{METRICS_TOKEN:-\}"/);
assert.match(dockerCompose, /\.\/data:\/app\/data:ro/);
assert.match(dockerCompose, /image:\s*spfantop\/fantetic-terminal-frontend:latest/);
assert.match(dockerCompose, /image:\s*spfantop\/fantetic-terminal-backend:latest/);
assert.match(dockerCompose, /image:\s*spfantop\/fantetic-terminal-remote-gateway:latest/);
assert.match(gatewayEntrypoint, /Waiting for Docker runtime secrets/);
assert.match(gatewayEntrypoint, /id -u/);
assert.match(gatewayEntrypoint, /exec su-exec guacd "\$0" --run/);
assert.match(frontendNginxConfig, /resolver\s+127\.0\.0\.11\s+ipv6=off/);
assert.match(frontendNginxConfig, /set\s+\$backend_upstream\s+http:\/\/backend:3001/);
assert.match(frontendNginxConfig, /proxy_pass\s+\$backend_upstream/);
assert.match(frontendDockerfile, /apk upgrade --no-cache/);
assert.doesNotMatch(
  frontendNginxConfig,
  /proxy_set_header\s+X-Forwarded-Proto\s+\$scheme;/,
  'The Docker frontend must not overwrite the original HTTPS scheme before proxying to the backend',
);
assert.equal(
  (frontendNginxConfig.match(/proxy_set_header\s+X-Forwarded-Proto\s+\$http_x_forwarded_proto;/g) ?? []).length,
  2,
  'Both API and WebSocket proxy routes must preserve the external forwarded protocol',
);

assert.match(singleImageDockerfile, /^FROM guacamole\/guacd:1\.6\.0@sha256:8974eaa9ba32f713daf311e7cc8cd7e4cdfba1edea39eed75524e78ef4b08f4f AS guacd-runtime$/m);
assert.match(singleImageDockerfile, /COPY --from=guacd-runtime \/ \/opt\/guacd-runtime\//);
assert.match(singleImageDockerfile, /COPY build-tools \.\/build-tools\//);
assert.match(singleImageDockerfile, /nginx tini python3 make g\+\+/);
assert.match(
  singleImageDockerfile,
  /npm_config_build_from_source=true npm ci --omit=dev --workspace=@fantetic-terminal\/backend --workspace=@fantetic-terminal\/remote-gateway/,
  'The all-in-one image must build native dependencies in its Debian runtime layer to avoid incompatible sqlite3 prebuilt binaries',
);
assert.match(singleImageDockerfile, /REMOTE_GATEWAY_API_BASE_DOCKER=http:\/\/127\.0\.0\.1:9090/);
assert.match(singleImageDockerfile, /REMOTE_GATEWAY_WS_URL_DOCKER=ws:\/\/127\.0\.0\.1:8080/);
assert.match(singleImageDockerfile, /ENTRYPOINT \["\/usr\/bin\/tini", "--", "node", "\/app\/supervisor\.js"\]/);
assert.match(singleImageDockerfile, /HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3/);
assert.match(singleImageSupervisor, /ALL_IN_ONE_STARTUP_TIMEOUT_MS/);
assert.match(singleImageSupervisor, /180_000/);
assert.match(securityWorkflow, /name: Smoke test all-in-one runtime/);
assert.match(securityWorkflow, /matrix\.smoke/);
assert.match(securityWorkflow, /docker restart "\$container_name"/);
assert.match(securityWorkflow, /docker stop --time 20 "\$container_name"/);
assert.match(securityWorkflow, /\.delivery-smoke/);
assert.match(securityWorkflow, /State\.ExitCode/);
assert.match(singleImageSupervisor, /chroot/);
assert.match(singleImageSupervisor, /REMOTE_GATEWAY_SHARED_SECRET/);
assert.match(singleImageSupervisor, /127\.0\.0\.1/);
assert.match(singleImageSupervisor, /SIGTERM/);
assert.match(singleImageSupervisor, /process/);
assert.match(singleImageNginxConfig, /access_log \/dev\/stdout fantetic_json/);
assert.match(singleImageNginxConfig, /error_log \/dev\/stderr warn/);
assert.match(singleImageNginxConfig, /\$uri/);
assert.doesNotMatch(singleImageNginxConfig, /\$request_uri/);

const supervisorBehaviorResult = spawnSync(
  process.execPath,
  [path.join(__dirname, 'single-image-supervisor.behavior-test.js')],
  { cwd: rootDir, encoding: 'utf8' },
);
assert.equal(
  supervisorBehaviorResult.status,
  0,
  supervisorBehaviorResult.stderr || supervisorBehaviorResult.stdout,
);

console.log('Delivery pipeline behavior checks passed');

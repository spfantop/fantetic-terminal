const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const {
  createElectronBackendReadinessProbe,
  waitForHttp,
} = require('../service-readiness');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
assert.match(
  mainSource,
  /const spawnedBackend = startBackendProcess\(backendDataPath\)/,
  'the readiness check must retain the child process it is proving ownership for',
);
assert.match(mainSource, /createElectronBackendReadinessProbe\(electronRuntimeNonce\)/);
assert.match(mainSource, /isTargetAlive:/);
assert.match(mainSource, /let productionServicesPromise;/);
assert.match(mainSource, /if \(productionServicesPromise\) return productionServicesPromise;/);
assert.match(mainSource, /show:\s*false/);
assert.match(mainSource, /once\('ready-to-show',[\s\S]*?\.show\(\)/);

const runtimeNonce = 'test-electron-runtime-nonce';
let ready = false;
let responseMode = 'valid';
let requestCount = 0;
const server = http.createServer((request, response) => {
  requestCount += 1;
  if (responseMode === 'not-found') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'not-found' }));
    return;
  }

  const challenge = request.headers['x-fantetic-readiness-challenge'];
  const proof = typeof challenge === 'string'
    ? createHmac('sha256', runtimeNonce).update(challenge).digest('hex')
    : '';
  if (ready) {
    response.setHeader(
      'x-fantetic-readiness-proof',
      responseMode === 'forged' ? '0'.repeat(64) : proof,
    );
  }
  response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: ready ? 'ready' : 'starting' }));
});

const listen = () => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const close = () => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

(async () => {
  await listen();
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const backendUrl = `http://127.0.0.1:${address.port}/api/v1/health/ready`;
  const readinessProbe = createElectronBackendReadinessProbe(runtimeNonce);
  const delayedReady = setTimeout(() => {
    ready = true;
  }, 50);

  try {
    await waitForHttp(backendUrl, {
      label: 'backend',
      timeoutMs: 1_000,
      intervalMs: 10,
      ...readinessProbe,
      isTargetAlive: () => true,
    });
    assert.ok(requestCount >= 2, 'health check should retry while the backend starts');

    responseMode = 'not-found';
    await assert.rejects(
      waitForHttp(backendUrl, {
        label: 'wrong service', timeoutMs: 30, intervalMs: 5, ...readinessProbe,
      }),
      /wrong service was not ready.*HTTP 404/,
    );

    responseMode = 'forged';
    await assert.rejects(
      waitForHttp(backendUrl, {
        label: 'forged service', timeoutMs: 30, intervalMs: 5, ...readinessProbe,
      }),
      /forged service was not ready.*readiness proof/i,
    );

    await assert.rejects(
      waitForHttp(backendUrl, {
        label: 'exited backend', timeoutMs: 1_000, intervalMs: 10, ...readinessProbe,
        isTargetAlive: () => false,
      }),
      /exited backend process exited before becoming ready/,
    );
  } finally {
    clearTimeout(delayedReady);
    await close();
  }

  await assert.rejects(
    waitForHttp('http://127.0.0.1:1/api/v1/health/ready', {
      label: 'unavailable backend',
      timeoutMs: 30,
      intervalMs: 10,
      ...createElectronBackendReadinessProbe(runtimeNonce),
    }),
    /unavailable backend was not ready/,
  );

  console.log('service readiness behavior passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

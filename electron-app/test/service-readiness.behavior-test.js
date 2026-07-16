const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { waitForHttp } = require('../service-readiness');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
assert.match(
  mainSource,
  /startBackendProcess\(backendDataPath\);\s+await waitForHttp\(`http:\/\/127\.0\.0\.1:\$\{PROD_BACKEND_PORT\}\/api\/v1\/health\/ready`,\s*\{\s*label: 'backend',\s*\}\);\s+await startFrontendServer\(\);/s,
  'the renderer must wait for the packaged backend health endpoint before it starts serving the UI',
);
assert.match(mainSource, /let productionServicesPromise;/);
assert.match(mainSource, /if \(productionServicesPromise\) return productionServicesPromise;/);
assert.match(mainSource, /show:\s*false/);
assert.match(mainSource, /once\('ready-to-show',[\s\S]*?\.show\(\)/);

let ready = false;
let requestCount = 0;
const server = http.createServer((_request, response) => {
  requestCount += 1;
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
  const delayedReady = setTimeout(() => {
    ready = true;
  }, 50);

  try {
    await waitForHttp(backendUrl, {
      label: 'backend',
      timeoutMs: 1_000,
      intervalMs: 10,
    });
    assert.ok(requestCount >= 2, 'health check should retry while the backend starts');
  } finally {
    clearTimeout(delayedReady);
    await close();
  }

  await assert.rejects(
    waitForHttp('http://127.0.0.1:1/api/v1/health/ready', {
      label: 'unavailable backend',
      timeoutMs: 30,
      intervalMs: 10,
    }),
    /unavailable backend was not ready/,
  );

  console.log('service readiness behavior passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

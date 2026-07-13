const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ELECTRON_NONCE_HEADER,
  addElectronNonceHeader,
  isAllowedPopupUrl,
  isTrustedRendererUrl,
} = require('../security');

const frontendUrl = 'http://localhost:22457';

assert.equal(isTrustedRendererUrl(`${frontendUrl}/workspace`, frontendUrl), true);
assert.equal(isTrustedRendererUrl('https://attacker.example/', frontendUrl), false);
assert.equal(isTrustedRendererUrl('http://localhost:22458/', frontendUrl), false);
assert.equal(isAllowedPopupUrl('about:blank'), true, 'internal terminal popouts must remain available');
assert.equal(isAllowedPopupUrl(''), true, 'empty window.open URLs resolve to internal about:blank popouts');
assert.equal(isAllowedPopupUrl(`${frontendUrl}/workspace`, frontendUrl), true);
assert.equal(isAllowedPopupUrl('https://attacker.example/'), false);

assert.deepEqual(
  addElectronNonceHeader({ url: 'http://localhost:22458/api/v1/status', requestHeaders: {} }, 'nonce-value'),
  { [ELECTRON_NONCE_HEADER]: 'nonce-value' },
);
assert.deepEqual(
  addElectronNonceHeader({ url: 'ws://localhost:22458/ws/', requestHeaders: { Upgrade: 'websocket' } }, 'nonce-value'),
  { Upgrade: 'websocket', [ELECTRON_NONCE_HEADER]: 'nonce-value' },
);
assert.deepEqual(
  addElectronNonceHeader({ url: 'http://127.0.0.1:22458/api/v1/status', requestHeaders: {} }, 'nonce-value'),
  {},
);
assert.deepEqual(
  addElectronNonceHeader({ url: 'https://attacker.example/', requestHeaders: {} }, 'nonce-value'),
  {},
);

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
assert.match(mainSource, /sandbox:\s*true/);
assert.match(mainSource, /setWindowOpenHandler/);
assert.match(mainSource, /will-navigate/);
assert.match(mainSource, /onBeforeSendHeaders/);
assert.match(mainSource, /if \(!isTrustedIpcSender\(event\)\) return;/);
assert.doesNotMatch(mainSource, /OutOfBlinkCors/);

console.log('electron trust seam behavior passed');

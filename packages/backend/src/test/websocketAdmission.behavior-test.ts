import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  FixedWindowAdmissionLimiter,
  classifyWebSocketPath,
  isWebSocketOriginAllowed,
} from '../websocket/admission';

const originList = new Set(['https://terminal.example.com']);
assert.equal(classifyWebSocketPath('/ws/'), 'standard');
assert.equal(classifyWebSocketPath('/ws/rdp-proxy'), 'rdp');
assert.equal(classifyWebSocketPath('/rdp-proxy'), 'rdp');
assert.equal(classifyWebSocketPath('/unknown'), null);
assert.equal(isWebSocketOriginAllowed('https://terminal.example.com', originList, 'https://internal.example', false), true);
assert.equal(isWebSocketOriginAllowed('https://attacker.example', originList, 'https://internal.example', false), false);
assert.equal(isWebSocketOriginAllowed(undefined, originList, 'https://internal.example', false), false);
assert.equal(isWebSocketOriginAllowed(undefined, originList, 'https://internal.example', true), true);

let now = 1000;
const limiter = new FixedWindowAdmissionLimiter({ windowMs: 1000, maxAttempts: 2, maxEntries: 10, now: () => now });
assert.equal(limiter.allow('user:1'), true);
assert.equal(limiter.allow('user:1'), true);
assert.equal(limiter.allow('user:1'), false);
now = 2001;
assert.equal(limiter.allow('user:1'), true);

const upgradeSource = fs.readFileSync(path.resolve('src/websocket/upgrade.ts'), 'utf8');
assert.match(upgradeSource, /createLogger\('WebSocketUpgrade'\)/);
assert.doesNotMatch(upgradeSource, /\bconsole\.(?:log|info|warn|error|debug)\b/);

console.log('websocket admission behavior ok');

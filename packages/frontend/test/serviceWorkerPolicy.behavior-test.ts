import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');
assert.match(source, /url\.pathname\.startsWith\('\/api\/'\)/, 'service worker must bypass API requests');
assert.match(source, /url\.pathname\.startsWith\('\/ws\/'\)/, 'service worker must bypass WebSocket paths');
assert.match(source, /request\.mode === 'navigate'[\s\S]*fetch\(request\)/, 'navigations must prefer the network');
assert.match(source, /self\.skipWaiting\(\)/);
assert.match(source, /self\.clients\.claim\(\)/);

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const websocketSource = fs.readFileSync(path.resolve('src/websocket.ts'), 'utf8');

assert.match(websocketSource, /maxPayload:\s*4\s*\*\s*1024\s*\*\s*1024/);
assert.match(websocketSource, /perMessageDeflate:\s*\{/);
assert.match(websocketSource, /threshold:\s*256/);
assert.match(websocketSource, /serverNoContextTakeover:\s*true/);
assert.match(websocketSource, /clientNoContextTakeover:\s*true/);


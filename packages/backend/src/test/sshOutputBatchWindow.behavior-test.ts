import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const outputBufferSource = fs.readFileSync(path.resolve('src/websocket/ssh-output-buffer.ts'), 'utf8');

assert.match(outputBufferSource, /SSH_OUTPUT_BATCH_WINDOW_MS\s*=\s*16/);
assert.doesNotMatch(outputBufferSource, /setImmediate\(\(\)\s*=>\s*flushSshOutput/);
assert.match(outputBufferSource, /setTimeout\(\(\)\s*=>\s*flushSshOutput\(state\),\s*SSH_OUTPUT_BATCH_WINDOW_MS\s*\)/);


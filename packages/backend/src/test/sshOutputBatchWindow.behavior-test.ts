import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const outputBufferSource = fs.readFileSync(path.resolve('src/websocket/ssh-output-buffer.ts'), 'utf8');
const heartbeatSource = fs.readFileSync(path.resolve('src/websocket/heartbeat.ts'), 'utf8');

assert.match(outputBufferSource, /SSH_OUTPUT_BATCH_WINDOW_MS\s*=\s*16/);
assert.doesNotMatch(outputBufferSource, /setImmediate\(\(\)\s*=>\s*flushSshOutput/);
assert.match(outputBufferSource, /INTERACTIVE_SSH_OUTPUT_FLUSH_BYTES\s*=\s*1024/);
assert.match(outputBufferSource, /queueMicrotask\(\(\)\s*=>\s*flushSshOutput\(state\)\)/);
assert.match(outputBufferSource, /setTimeout\(\(\)\s*=>\s*flushSshOutput\(state\),\s*SSH_OUTPUT_BATCH_WINDOW_MS\s*\)/);

assert.match(heartbeatSource, /HEARTBEAT_MISSED_LIMIT\s*=\s*2/);
assert.match(heartbeatSource, /missedHeartbeatCount/);

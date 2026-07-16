import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const outputBufferSource = fs.readFileSync(path.resolve('src/websocket/ssh-output-buffer.ts'), 'utf8');
const heartbeatSource = fs.readFileSync(path.resolve('src/websocket/heartbeat.ts'), 'utf8');
const websocketSource = fs.readFileSync(path.resolve('src/websocket.ts'), 'utf8');
const sshHandlerSource = fs.readFileSync(path.resolve('src/websocket/handlers/ssh.handler.ts'), 'utf8');
const sshServiceSource = fs.readFileSync(path.resolve('src/services/ssh.service.ts'), 'utf8');
const wsConnectionHandlerSource = fs.readFileSync(path.resolve('src/websocket/connection.ts'), 'utf8');
const terminalSource = fs.readFileSync(path.resolve('../frontend/src/components/Terminal.vue'), 'utf8');
const sshTerminalSource = fs.readFileSync(path.resolve('../frontend/src/composables/useSshTerminal.ts'), 'utf8');
const wsConnectionSource = fs.readFileSync(path.resolve('../frontend/src/composables/useWebSocketConnection.ts'), 'utf8');

assert.match(outputBufferSource, /SSH_OUTPUT_BATCH_WINDOW_MS\s*=\s*16/);
assert.doesNotMatch(outputBufferSource, /setImmediate\(\(\)\s*=>\s*flushSshOutput/);
assert.match(outputBufferSource, /INTERACTIVE_SSH_OUTPUT_FLUSH_BYTES\s*=\s*1024/);
assert.match(outputBufferSource, /queueMicrotask\(\(\)\s*=>\s*flushSshOutput\(state\)\)/);
assert.match(outputBufferSource, /setTimeout\(\(\)\s*=>\s*flushSshOutput\(state\),\s*SSH_OUTPUT_BATCH_WINDOW_MS\s*\)/);

assert.match(heartbeatSource, /HEARTBEAT_MISSED_LIMIT\s*=\s*2/);
assert.match(heartbeatSource, /missedHeartbeatCount/);

assert.match(websocketSource, /threshold:\s*64\s*\*\s*1024/);
assert.match(outputBufferSource, /sendSshOutputFrame\(state,\s*chunk,\s*\{\s*compress:\s*false\s*\}\)/);
assert.match(sshHandlerSource, /createSuspendLogBatcher/);
assert.match(sshHandlerSource, /flushSuspendLogBatcher/);
assert.match(terminalSource, /ensureSearchAddonLoaded/);
assert.doesNotMatch(terminalSource, /terminal\.loadAddon\(searchAddon\)/);
assert.match(terminalSource, /loadWebLinksAddonIfEnabled/);
assert.doesNotMatch(terminalSource, /terminal\.loadAddon\(new WebLinksAddon\(\)\)/);
assert.match(sshTerminalSource, /OUTPUT_FRAME_BUDGET_MIN_BYTES\s*=\s*16\s*\*\s*1024/);
assert.match(sshTerminalSource, /OUTPUT_FRAME_BUDGET_MAX_BYTES\s*=\s*128\s*\*\s*1024/);
assert.match(sshTerminalSource, /let outputFrameBudgetBytes\s*=\s*OUTPUT_FRAME_BUDGET_DEFAULT_BYTES/);
assert.match(sshTerminalSource, /adjustOutputFrameBudget/);
assert.match(wsConnectionSource, /latencySamples/);
assert.match(wsConnectionSource, /APP_LATENCY_PROBE_INTERVAL_MS\s*=\s*15000/);
assert.match(wsConnectionSource, /startAppLatencyProbe/);
assert.match(wsConnectionSource, /lastLatencyMs/);
assert.match(wsConnectionSource, /missedLatencyProbeCount/);
assert.match(wsConnectionHandlerSource, /case 'client:ping'/);
assert.match(wsConnectionHandlerSource, /client:pong/);
assert.match(sshServiceSource, /resolveSshKeepaliveConfig/);
assert.match(sshServiceSource, /SSH_KEEPALIVE_INTERVAL_MS/);
assert.match(sshServiceSource, /SSH_KEEPALIVE_COUNT_MAX/);
assert.match(sshServiceSource, /DEFAULT_SSH_KEEPALIVE_INTERVAL_MS\s*=\s*10000/);
assert.match(sshServiceSource, /DEFAULT_SSH_KEEPALIVE_COUNT_MAX\s*=\s*30/);

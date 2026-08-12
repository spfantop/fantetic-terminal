import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createLatencyPongMessage,
  encodeCoreServerMessage,
  encodeSshOutputFrame,
} from '../../backend/src/websocket/core-server-message';
import {
  decodeServerMessageFrame,
  WebSocketProtocolError,
} from '../../frontend/src/websocket/decode-server-message';

const encoded = encodeCoreServerMessage({
  type: 'ssh:connected',
  payload: {
    connectionId: 42,
    sessionId: 'session-42',
    serverCapabilities: { sshBinaryInput: true, sshBinaryOutput: true },
  },
});

assert.deepEqual(decodeServerMessageFrame(encoded), {
  kind: 'terminal-connected',
  message: {
    type: 'ssh:connected',
    payload: {
      connectionId: 42,
      sessionId: 'session-42',
      serverCapabilities: { sshBinaryInput: true, sshBinaryOutput: true },
    },
  },
});

assert.throws(
  () => decodeServerMessageFrame(JSON.stringify({
    type: 'ssh:connected',
    payload: { connectionId: 42 },
  })),
  WebSocketProtocolError,
  'known messages must not fall through the legacy path when their payload is malformed',
);

assert.deepEqual(
  decodeServerMessageFrame(encodeCoreServerMessage(createLatencyPongMessage({
    type: 'client:ping',
    payload: { id: 'probe-1', sentAt: 1_234, sessionId: 'session-42' },
  }, 1_250))),
  {
    kind: 'latency-pong',
    message: {
      type: 'client:pong',
      payload: { id: 'probe-1', sentAt: 1_234, sessionId: 'session-42', serverAt: 1_250 },
    },
  },
);

assert.throws(
  () => createLatencyPongMessage({
    type: 'client:ping',
    payload: { id: 'probe-1' },
  }, 1_250),
  /client:ping has an invalid payload/,
);

const binaryOutput = decodeServerMessageFrame(encodeSshOutputFrame(Buffer.from('hello'), true));
assert.equal(binaryOutput.kind, 'ssh-output');
assert.deepEqual(
  binaryOutput.kind === 'ssh-output' ? Array.from(binaryOutput.message.payload as Uint8Array) : [],
  Array.from(Buffer.from('hello')),
);
assert.equal(binaryOutput.kind === 'ssh-output' ? binaryOutput.message.encoding : undefined, 'binary');

assert.deepEqual(
  decodeServerMessageFrame(encodeSshOutputFrame(Buffer.from('hello'), false)),
  {
    kind: 'ssh-output',
    message: {
      type: 'ssh:output',
      payload: Buffer.from('hello').toString('base64'),
      encoding: 'base64',
    },
  },
);

assert.throws(
  () => decodeServerMessageFrame('{"type":"ssh:output","payload":42,"encoding":"base64"}'),
  WebSocketProtocolError,
);
assert.throws(
  () => decodeServerMessageFrame('{"type":"ssh:output","payload":"===","encoding":"base64"}'),
  WebSocketProtocolError,
);

assert.deepEqual(
  decodeServerMessageFrame('{"type":"sftp_ready","payload":{"connectionId":42}}'),
  {
    kind: 'legacy',
    message: { type: 'sftp_ready', payload: { connectionId: 42 } },
  },
);

const frontendConnectionSource = readFileSync('../frontend/src/composables/useWebSocketConnection.ts', 'utf8');
const backendConnectionSource = readFileSync('../backend/src/websocket/connection.ts', 'utf8');
assert.match(frontendConnectionSource, /decodeServerMessageFrame\(rawData\)/);
assert.doesNotMatch(frontendConnectionSource, /const parseIncomingMessage/);
assert.doesNotMatch(frontendConnectionSource, /console\.error\([^\n]*event\.data/);
assert.doesNotMatch(frontendConnectionSource, /new Blob\(\[rawData\]\)/);
assert.match(backendConnectionSource, /createLatencyPongMessage\(parsedMessage\)/);

console.log('WebSocket core protocol behavior passed');

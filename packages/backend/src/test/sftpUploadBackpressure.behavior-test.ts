import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sftpService = readFileSync(resolve('src/sftp/sftp.service.ts'), 'utf8');
const sftpHandler = readFileSync(resolve('src/websocket/handlers/sftp.handler.ts'), 'utf8');

assert.doesNotMatch(
  sftpService,
  /interface\s+(?:ServerStatus|NetworkStats)|DEFAULT_POLLING_INTERVAL|previousNetStats/,
  'SFTP upload service should not retain status-monitoring concepts',
);

assert.match(
  sftpService,
  /chunkQueue:\s*Promise<void>/,
  'active SFTP upload state should keep a per-upload promise queue',
);

assert.match(
  sftpService,
  /lastProgressSentAt:\s*number/,
  'active SFTP upload state should throttle progress notifications',
);

assert.match(
  sftpService,
  /sendUploadChunkAck\(/,
  'backend should send a chunk ack after each chunk is accepted by the write stream',
);

assert.match(
  sftpService,
  /type:\s*'sftp:upload:chunk:ack'/,
  'backend should define the sftp:upload:chunk:ack message',
);

assert.match(
  sftpService,
  /uploadState\.chunkQueue\s*=\s*uploadState\.chunkQueue\.then/,
  'backend should serialize chunk handling per upload',
);

assert.match(
  sftpService,
  /expectedChunkIndex/,
  'backend should reject or guard out-of-order upload chunks',
);

assert.match(
  sftpService,
  /byteLength/,
  'backend should validate decoded chunk length against client metadata',
);

assert.match(
  sftpService,
  /uploadState\.sessionId\s*!==\s*sessionId/,
  'upload chunks and cancellation must reject a request from another SFTP session',
);

assert.match(
  sftpService,
  /if \(uploadState\?\.sessionId === sessionId\) \{\s*this\.cancelUploadInternal/s,
  'an unknown session may only clean up an upload that is known to belong to it',
);

assert.match(
  sftpHandler,
  /typeof payload\?\.data !== 'string'/,
  'upload chunk handler should allow an empty string payload for zero-byte files',
);

assert.match(
  sftpHandler,
  /payload\.byteLength/,
  'upload chunk handler should forward byteLength metadata to the SFTP service',
);

assert.match(sftpHandler, /createLogger\('SftpWebSocketHandler'\)/);
assert.doesNotMatch(sftpHandler, /\bconsole\.(?:log|info|warn|error|debug)\b/);
assert.doesNotMatch(sftpHandler, /RemotePath|remotePath: payload/);

console.log('backend sftp upload backpressure behavior ok');

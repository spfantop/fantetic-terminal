import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const uploader = readFileSync(resolve('src/composables/useFileUploader.ts'), 'utf8');
const wsDeps = readFileSync(resolve('src/composables/useSftpActions.ts'), 'utf8');

assert.match(
  wsDeps,
  /getBufferedAmount\?:\s*\(\)\s*=>\s*number/,
  'WebSocketDependencies should expose bufferedAmount so upload can apply client-side backpressure',
);

assert.match(
  uploader,
  /const\s+MAX_CONCURRENT_UPLOADS\s*=\s*1/,
  'SFTP uploads should be queued to one active upload per file manager instance',
);

assert.match(
  uploader,
  /const\s+SFTP_UPLOAD_BUFFERED_AMOUNT_LIMIT\s*=\s*\d+\s*\*\s*1024\s*\*\s*1024/,
  'SFTP upload should define a WebSocket bufferedAmount ceiling',
);

assert.match(
  uploader,
  /reader\.readAsArrayBuffer\(slice\)/,
  'SFTP upload should read chunks as ArrayBuffer instead of DataURL strings',
);

assert.equal(
  uploader.includes('readAsDataURL'),
  false,
  'SFTP upload should avoid readAsDataURL base64 work on the main thread',
);

assert.match(
  uploader,
  /type:\s*'sftp:upload:chunk'[\s\S]*payload:\s*\{[\s\S]*byteLength:/,
  'SFTP upload chunks should include the decoded byte length for validation and progress',
);

assert.match(
  uploader,
  /onMessage\('sftp:upload:chunk:ack'/,
  'SFTP upload should wait for a chunk ack before sending the next chunk',
);

assert.match(
  uploader,
  /const\s+uploadQueue\s*:\s*string\[\]\s*=\s*\[\]/,
  'SFTP upload should keep a queue of pending upload ids',
);

assert.match(
  uploader,
  /let\s+activeUploadCount\s*=\s*0/,
  'SFTP upload should track active uploads for queue scheduling',
);

assert.match(
  uploader,
  /scheduleUploadQueue\(\)/,
  'SFTP upload should schedule queued uploads after terminal states',
);

console.log('sftp upload backpressure behavior ok');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sftpServiceSource = readFileSync('src/sftp/sftp.service.ts', 'utf8');
const sftpControllerSource = readFileSync('src/sftp/sftp.controller.ts', 'utf8');
const downloadControllerSource = sftpControllerSource.split('// --- WebSocket Message Handlers')[0];

assert.match(sftpServiceSource, /const logger = createLogger\('SftpService'\)/);
assert.doesNotMatch(
  sftpServiceSource,
  /console\.\w+\(`\[SFTP (?:Compress|Decompress)/,
  'archive commands, remote paths and command output must not be written through console',
);
assert.match(sftpServiceSource, /const MAX_SFTP_COMMAND_STDERR_LENGTH = 16 \* 1024/);
assert.doesNotMatch(
  sftpServiceSource,
  /let stdoutData = ''/,
  'archive stdout must be drained rather than accumulated in memory',
);
assert.match(downloadControllerSource, /const logger = createLogger\('SftpController'\)/);
assert.doesNotMatch(
  downloadControllerSource,
  /\bconsole\.(log|warn|error|debug)/,
  'download handlers must not log user identifiers, sessions or remote paths through console',
);
assert.doesNotMatch(
  sftpControllerSource,
  /export const handle(?:Compress|Decompress)Request/,
  'the retired controller command handlers must not remain importable',
);

console.log('SFTP command logging behavior passed');

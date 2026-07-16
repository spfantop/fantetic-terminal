import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SftpRemoteFileOperations } from '../sftp/sftp-remote-file-operations.service';

const operations = new SftpRemoteFileOperations();
const mkdirCalls: Array<{ path: string; recursive: boolean }> = [];
const existingDirectories = new Set(['/']);

const sftp = {
  lstat(path: string, callback: (error: Error | null, stats?: { isDirectory(): boolean }) => void) {
    if (existingDirectories.has(path)) {
      callback(null, { isDirectory: () => true });
      return;
    }
    const error = new Error('No such file') as Error & { code?: string };
    error.code = 'ENOENT';
    callback(error);
  },
  mkdir(path: string, optionsOrCallback: { recursive?: boolean } | ((error?: Error) => void), maybeCallback?: (error?: Error) => void) {
    const recursive = typeof optionsOrCallback === 'object' && optionsOrCallback.recursive === true;
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback!;
    mkdirCalls.push({ path, recursive });

    if (recursive) {
      callback(new Error('recursive mkdir is not supported'));
      return;
    }

    existingDirectories.add(path);
    callback();
  },
};

await operations.ensureDirectoryExists(sftp as never, '/workspace/releases');

assert.deepEqual(mkdirCalls, [
  { path: '/workspace/releases', recursive: true },
  { path: '/workspace', recursive: true },
  { path: '/workspace', recursive: false },
  { path: '/workspace/releases', recursive: false },
]);

const sftpServiceSource = readFileSync(resolve('src/sftp/sftp.service.ts'), 'utf8');
const remoteFileOperationsSource = readFileSync(resolve('src/sftp/sftp-remote-file-operations.service.ts'), 'utf8');
assert.match(
  sftpServiceSource,
  /remoteFileOperations\.ensureDirectoryExists\(/,
  'SftpService should delegate remote directory setup instead of owning filesystem primitives',
);
assert.match(
  sftpServiceSource,
  /remoteFileOperations\.copyDirectoryRecursively\(/,
  'SftpService should delegate recursive copy to the remote file operations module',
);
assert.doesNotMatch(
  sftpServiceSource,
  /private async ensureDirectoryExists\(/,
  'the old directory setup implementation must not remain in SftpService',
);
assert.match(
  remoteFileOperationsSource,
  /createLogger\(['"]SftpRemoteFileOperations['"]\)/,
  'remote file operations should use the shared structured logger',
);
assert.doesNotMatch(
  remoteFileOperationsSource,
  /console\.(?:log|warn|error|debug)\(/,
  'remote file operations should not bypass structured logging',
);

console.log('SFTP remote file operations behavior passed');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quotePosixShellArgument } from '../utils/posix-shell-quote';

assert.equal(quotePosixShellArgument('/srv/$(id); `whoami`'), "'/srv/$(id); `whoami`'");
assert.equal(quotePosixShellArgument("O'Reilly"), "'O'\\''Reilly'");
assert.equal(quotePosixShellArgument(''), "''");

const sftpServiceSource = readFileSync('src/sftp/sftp.service.ts', 'utf8');
assert.match(
  sftpServiceSource,
  /const command = `rm -rf -- \$\{quotePosixShellArgument\(path\)\}`/,
  'recursive deletion must pass the supplied path as one POSIX shell argument',
);
assert.doesNotMatch(
  sftpServiceSource,
  /rm -rf "\$\{path\.replace\(/,
  'double-quoted paths still allow command substitution and must not be used for shell commands',
);
assert.doesNotMatch(
  sftpServiceSource,
  /sudo rm -rf/,
  'file-manager deletion must not silently escalate privileges through sudo',
);
assert.match(sftpServiceSource, /zip -r -- \$\{quotedDestName\} \$\{quotedRelativeSources\}/);
assert.match(sftpServiceSource, /tar -czvf -- \$\{quotedDestName\} \$\{quotedRelativeSources\}/);
assert.match(sftpServiceSource, /tar -cjvf -- \$\{quotedDestName\} \$\{quotedRelativeSources\}/);
assert.match(sftpServiceSource, /unzip -o -- \$\{quotedArchiveBasename\}/);
assert.match(sftpServiceSource, /tar -xzvf -- \$\{quotedArchiveBasename\}/);
assert.match(sftpServiceSource, /tar -xjvf -- \$\{quotedArchiveBasename\}/);

console.log('POSIX shell argument quoting behavior passed');

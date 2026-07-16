import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createFilesystemReadinessChecks } from '../health/filesystem-readiness';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-readiness-'));
try {
  const checks = createFilesystemReadinessChecks({
    appDataPath: root,
    backupDirectoryPath: path.join(root, 'backups'),
    minimumFreeBytes: 0,
  });
  await checks.checkDisk();
  await checks.checkBackupDirectory();
  assert.deepEqual(fs.readdirSync(path.join(root, 'backups')), [], 'write probe must clean itself up');

  await assert.rejects(
    createFilesystemReadinessChecks({
      appDataPath: root,
      backupDirectoryPath: path.join(root, 'backups'),
      minimumFreeBytes: Number.MAX_SAFE_INTEGER,
    }).checkDisk(),
    /Insufficient free disk space/,
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('filesystem readiness behavior passed');

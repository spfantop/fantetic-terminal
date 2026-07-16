import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ENCRYPTION_KEY = '33'.repeat(32);
const { createBackupService } = await import('../backup/backup.service');

const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-backup-policy-'));
let sequence = 0;
const service = createBackupService({
  appDataPath,
  snapshotDatabase: async target => fs.writeFileSync(target, `snapshot-${sequence}`),
  readSchemaVersion: async () => 23,
  now: () => new Date(`2026-07-13T00:0${sequence++}:00.000Z`),
});

await service.createBackupWithPolicy({ retentionCount: 2 });
await service.createBackupWithPolicy({ retentionCount: 2 });
await service.createBackupWithPolicy({ retentionCount: 2 });

const retained = service.listBackups();
assert.equal(retained.length, 2);
assert.deepEqual(retained.map(backup => backup.createdAt), [
  '2026-07-13T00:02:00.000Z',
  '2026-07-13T00:01:00.000Z',
]);

const archiveRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-backup-archive-'));
const archived = await service.createBackupWithPolicy({ retentionCount: 2, archiveRootPath });
assert.equal(fs.existsSync(path.join(archiveRootPath, archived.id, 'manifest.json')), true);
assert.throws(() => service.archiveBackup(archived.id, appDataPath), /must not overlap/);

fs.rmSync(appDataPath, { recursive: true, force: true });
fs.rmSync(archiveRootPath, { recursive: true, force: true });
console.log('backup retention policy behavior ok');

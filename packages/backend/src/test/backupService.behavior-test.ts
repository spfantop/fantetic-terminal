import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ENCRYPTION_KEY = '22'.repeat(32);
const { applyScheduledRestore, createBackupService } = await import('../backup/backup.service');
const routeSource = fs.readFileSync(path.resolve(process.cwd(), 'src/backup/backup.routes.ts'), 'utf8');
assert.match(routeSource, /router\.use\(isAuthenticated, requireSystemAdministrator\)/);

const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-backup-test-'));
fs.mkdirSync(path.join(appDataPath, 'uploads'), { recursive: true });
fs.writeFileSync(path.join(appDataPath, 'uploads', 'avatar.txt'), 'avatar');
fs.mkdirSync(path.join(appDataPath, 'session-recordings', '2026-07'), { recursive: true });
fs.writeFileSync(path.join(appDataPath, 'session-recordings', '2026-07', 'recording.enc'), 'encrypted-recording');

const service = createBackupService({
  appDataPath,
  snapshotDatabase: async target => fs.writeFileSync(target, 'sqlite-snapshot'),
  readSchemaVersion: async () => 23,
  now: () => new Date('2026-07-13T00:00:00.000Z'),
});

const backup = await service.createBackup();
assert.match(backup.id, /^20260713T000000-/);
assert.equal((await service.verifyBackup(backup.id)).valid, true);
assert.equal(fs.existsSync(path.join(appDataPath, 'backups', backup.id, 'session-recordings', '2026-07', 'recording.enc')), true);
assert.throws(() => service.readBackup('../escape'));

fs.writeFileSync(path.join(appDataPath, 'backups', backup.id, 'uploads', 'avatar.txt'), 'tampered');
assert.equal((await service.verifyBackup(backup.id)).valid, false);
fs.writeFileSync(path.join(appDataPath, 'backups', backup.id, 'uploads', 'unexpected.txt'), 'not-declared');
assert.match((await service.verifyBackup(backup.id)).errors.join(';'), /Unexpected file/);

await assert.rejects(() => service.scheduleRestore(backup.id), /integrity/i);

const recoverable = await service.createBackup();
await service.scheduleRestore(recoverable.id);
fs.writeFileSync(path.join(appDataPath, 'fantetic-terminal.db'), 'broken-live-db');
fs.writeFileSync(path.join(appDataPath, 'uploads', 'avatar.txt'), 'changed-after-backup');
assert.equal(await applyScheduledRestore(appDataPath), recoverable.id);
assert.equal(fs.readFileSync(path.join(appDataPath, 'fantetic-terminal.db'), 'utf8'), 'sqlite-snapshot');
assert.equal(fs.readFileSync(path.join(appDataPath, 'uploads', 'avatar.txt'), 'utf8'), 'avatar');
assert.equal(fs.existsSync(path.join(appDataPath, '.restore-request.json')), false);

fs.rmSync(appDataPath, { recursive: true, force: true });
console.log('backup service behavior ok');

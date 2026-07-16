import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';

const { createBackupService } = await import('../backup/backup.service');
const { verifyBackupRecovery } = await import('../backup/recovery-verification');

const close = (database: sqlite3.Database): Promise<void> => new Promise((resolve, reject) => {
  database.close(error => error ? reject(error) : resolve());
});
const run = (database: sqlite3.Database, sql: string): Promise<void> => new Promise((resolve, reject) => {
  database.run(sql, error => error ? reject(error) : resolve());
});

const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-recovery-source-'));
const encryptionKey = '44'.repeat(32);
const runtimeEnvPath = path.join(appDataPath, '.env');
const encryptionKeyName = ['ENCRYPTION', 'KEY'].join('_');
const sessionSecretName = ['SESSION', 'SECRET'].join('_');
fs.writeFileSync(runtimeEnvPath, `${encryptionKeyName}=${encryptionKey}\n${sessionSecretName}=must-not-appear-in-report\n`, { mode: 0o600 });
const databasePath = path.join(appDataPath, 'fantetic-terminal.db');
const database = new sqlite3.Database(databasePath);
await run(database, 'CREATE TABLE migrations(id INTEGER PRIMARY KEY)');
await run(database, 'INSERT INTO migrations(id) VALUES (42)');
await run(database, 'CREATE TABLE recovery_probe(value TEXT NOT NULL)');
await run(database, "INSERT INTO recovery_probe(value) VALUES ('restored')");
await close(database);

const service = createBackupService({
  appDataPath,
  encryptionKey,
  snapshotDatabase: async target => fs.copyFileSync(databasePath, target),
  readSchemaVersion: async () => 42,
  now: () => new Date('2026-07-15T00:00:00.000Z'),
});
const backup = await service.createBackup();
const report = await verifyBackupRecovery({
  appDataPath,
  runtimeEnvPath,
  backupId: backup.id,
  now: () => new Date('2026-07-15T00:00:30.000Z'),
});

assert.deepEqual(report.backup, {
  id: backup.id,
  manifestFormatVersion: 1,
  createdAt: backup.createdAt,
  schemaVersion: 42,
  manifestSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(appDataPath, 'backups', backup.id, 'manifest.json'))).digest('hex'),
});
assert.equal(report.databaseIntegrity, 'ok');
assert.equal(report.restoredSchemaVersion, 42);
assert.equal(report.rpoSeconds, 30);
assert.ok(report.rtoMilliseconds >= 0);
const reportsPath = path.join(appDataPath, 'backups', 'recovery-verifications');
const reportFile = fs.readdirSync(reportsPath).find(name => name.endsWith('.json'));
assert.ok(reportFile);
const persistedReport = fs.readFileSync(path.join(reportsPath, reportFile!), 'utf8');
assert.match(persistedReport, /manifestSha256/);
assert.doesNotMatch(persistedReport, /must-not-appear-in-report|ENCRYPTION_KEY|444444/);
assert.equal(service.countBackups(), 1, 'recovery reports must not be counted as backups');

fs.rmSync(appDataPath, { recursive: true, force: true });
console.log('backup recovery verification behavior ok');

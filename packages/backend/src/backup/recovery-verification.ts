import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';

import { applyScheduledRestore, createBackupService } from './backup.service';

export interface RecoveryVerificationReport {
  formatVersion: 1;
  verifiedAt: string;
  backup: {
    id: string;
    manifestFormatVersion: number;
    createdAt: string;
    schemaVersion: number;
    manifestSha256: string;
  };
  databaseIntegrity: 'ok';
  restoredSchemaVersion: number;
  rpoSeconds: number;
  rtoMilliseconds: number;
}

const assertInside = (targetPath: string, parentPath: string): string => {
  const target = path.resolve(targetPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Recovery verification path is outside its allowed directory.');
  }
  return target;
};

const sha256File = (filePath: string): string => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const getRow = <T>(database: sqlite3.Database, sql: string): Promise<T> => new Promise((resolve, reject) => {
  database.get(sql, (error, row: T) => error ? reject(error) : resolve(row));
});

const closeDatabase = (database: sqlite3.Database): Promise<void> => new Promise((resolve, reject) => {
  database.close(error => error ? reject(error) : resolve());
});

const readRuntimeEncryptionKey = (appDataPath: string, runtimeEnvPath: string): string => {
  const dataRoot = fs.realpathSync(appDataPath);
  const keyFile = fs.realpathSync(runtimeEnvPath);
  assertInside(keyFile, dataRoot);
  const encryptionKey = dotenv.parse(fs.readFileSync(keyFile, 'utf8')).ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error('Runtime environment file does not contain ENCRYPTION_KEY.');
  return encryptionKey;
};

const readRestoredDatabase = async (databasePath: string): Promise<{ integrity: 'ok'; schemaVersion: number }> => {
  const database = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);
  try {
    const integrity = await getRow<{ integrity_check: string }>(database, 'PRAGMA integrity_check');
    if (integrity.integrity_check !== 'ok') throw new Error('Restored database integrity check failed.');
    const schema = await getRow<{ version: number | null }>(database, 'SELECT MAX(id) AS version FROM migrations');
    return { integrity: 'ok', schemaVersion: schema.version ?? 0 };
  } finally {
    await closeDatabase(database);
  }
};

export const verifyBackupRecovery = async ({
  appDataPath,
  runtimeEnvPath,
  backupId,
  now = () => new Date(),
}: {
  appDataPath: string;
  runtimeEnvPath: string;
  backupId?: string;
  now?: () => Date;
}): Promise<RecoveryVerificationReport> => {
  const sourceDataPath = fs.realpathSync(appDataPath);
  const encryptionKey = readRuntimeEncryptionKey(sourceDataPath, runtimeEnvPath);
  const sourceService = createBackupService({
    appDataPath: sourceDataPath,
    encryptionKey,
    snapshotDatabase: async () => { throw new Error('Snapshot is unavailable during recovery verification.'); },
    readSchemaVersion: async () => 0,
  });
  const selectedBackupId = backupId ?? sourceService.listBackups()[0]?.id;
  if (!selectedBackupId) throw new Error('No backup is available for recovery verification.');
  const verification = await sourceService.verifyBackup(selectedBackupId);
  if (!verification.valid || !verification.manifest) {
    throw new Error(`Backup integrity verification failed: ${verification.errors.join('; ')}`);
  }

  const startedAt = now();
  const startedMilliseconds = Date.now();
  const isolatedDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-recovery-verification-'));
  try {
    const isolatedBackupsPath = path.join(isolatedDataPath, 'backups');
    fs.mkdirSync(isolatedBackupsPath, { recursive: true });
    fs.cpSync(
      assertInside(path.join(sourceService.backupsPath, selectedBackupId), sourceService.backupsPath),
      assertInside(path.join(isolatedBackupsPath, selectedBackupId), isolatedBackupsPath),
      { recursive: true, errorOnExist: true },
    );
    fs.writeFileSync(path.join(isolatedDataPath, '.env'), `ENCRYPTION_KEY=${encryptionKey}\n`, { mode: 0o600 });

    const isolatedService = createBackupService({
      appDataPath: isolatedDataPath,
      encryptionKey,
      snapshotDatabase: async () => { throw new Error('Snapshot is unavailable during recovery verification.'); },
      readSchemaVersion: async () => 0,
    });
    await isolatedService.scheduleRestore(selectedBackupId);
    const restoredBackupId = await applyScheduledRestore(isolatedDataPath, encryptionKey);
    if (restoredBackupId !== selectedBackupId) throw new Error('Isolated restore did not apply the requested backup.');
    const database = await readRestoredDatabase(path.join(isolatedDataPath, 'fantetic-terminal.db'));
    const verifiedAt = now();
    const report: RecoveryVerificationReport = {
      formatVersion: 1,
      verifiedAt: verifiedAt.toISOString(),
      backup: {
        id: selectedBackupId,
        manifestFormatVersion: verification.manifest.formatVersion,
        createdAt: verification.manifest.createdAt,
        schemaVersion: verification.manifest.schemaVersion,
        manifestSha256: sha256File(path.join(sourceService.backupsPath, selectedBackupId, 'manifest.json')),
      },
      databaseIntegrity: database.integrity,
      restoredSchemaVersion: database.schemaVersion,
      rpoSeconds: Math.max(0, Math.floor((verifiedAt.getTime() - new Date(verification.manifest.createdAt).getTime()) / 1000)),
      rtoMilliseconds: Date.now() - startedMilliseconds,
    };
    const reportDirectory = path.join(sourceService.backupsPath, 'recovery-verifications');
    fs.mkdirSync(reportDirectory, { recursive: true });
    const filename = `${startedAt.toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(4).toString('hex')}.json`;
    const reportPath = assertInside(path.join(reportDirectory, filename), reportDirectory);
    const temporaryReportPath = `${reportPath}.tmp`;
    fs.writeFileSync(temporaryReportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryReportPath, reportPath);
    return report;
  } finally {
    fs.rmSync(isolatedDataPath, { recursive: true, force: true });
  }
};

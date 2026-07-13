import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';

const main = async () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-db-backup-'));
  process.env.APP_BACKEND_DATA_PATH = appDataPath;
  const { backupDatabaseTo, closeDbInstance, getDbInstance, runDb } = await import('../database/connection');
  const db = await getDbInstance();
  await runDb(db, 'CREATE TABLE backup_probe(value TEXT NOT NULL)');
  await runDb(db, 'INSERT INTO backup_probe(value) VALUES (?)', ['consistent']);
  const snapshotPath = path.join(appDataPath, 'snapshot.db');
  await backupDatabaseTo(snapshotPath);

  const snapshot = new sqlite3.Database(snapshotPath, sqlite3.OPEN_READONLY);
  const row = await new Promise<{ value: string }>((resolve, reject) => {
    snapshot.get('SELECT value FROM backup_probe', (error, value: { value: string }) => error ? reject(error) : resolve(value));
  });
  assert.deepEqual(row, { value: 'consistent' });
  await new Promise<void>((resolve, reject) => snapshot.close(error => error ? reject(error) : resolve()));
  await closeDbInstance();
  fs.rmSync(appDataPath, { recursive: true, force: true });
  console.log('database online backup behavior ok');
};

main().catch(error => { console.error(error); process.exitCode = 1; });

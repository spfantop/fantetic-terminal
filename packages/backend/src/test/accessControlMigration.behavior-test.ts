import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';

import { runMigrations } from '../database/migrations';

const db = new sqlite3.Database(':memory:');
const exec = (sql: string) => new Promise<void>((resolve, reject) => {
  db.exec(sql, (error) => error ? reject(error) : resolve());
});
const get = <T>(sql: string) => new Promise<T>((resolve, reject) => {
  db.get(sql, (error, row: T) => error ? reject(error) : resolve(row));
});

await exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
  INSERT INTO migrations(id, name, applied_at) VALUES (16, 'legacy baseline', 0);
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE);
  CREATE TABLE connections (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE proxies (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE ssh_keys (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE connection_folders (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
  INSERT INTO users(id, username) VALUES (3, 'legacy-admin');
  INSERT INTO connections(id, name) VALUES (30, 'legacy-connection');
`);

await runMigrations(db);

assert.deepEqual(
  await get<{ currentVersion: number }>('SELECT MAX(id) AS currentVersion FROM migrations'),
  { currentVersion: 17 },
);
assert.deepEqual(
  await get<{ system_role: string }>('SELECT system_role FROM users WHERE id = 3'),
  { system_role: 'super_admin' },
);
assert.deepEqual(
  await get<{ owner_user_id: number }>('SELECT owner_user_id FROM connections WHERE id = 30'),
  { owner_user_id: 3 },
);
assert.deepEqual(
  await get<{ count: number }>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='user_groups'"),
  { count: 1 },
);

await new Promise<void>((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

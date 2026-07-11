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
  CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE connection_tags (connection_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY(connection_id, tag_id));
  CREATE TABLE command_history (id INTEGER PRIMARY KEY, command TEXT, timestamp INTEGER);
  CREATE TABLE path_history (id INTEGER PRIMARY KEY, path TEXT, timestamp INTEGER);
  CREATE TABLE quick_commands (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE quick_command_tags (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE favorite_paths (id INTEGER PRIMARY KEY, path TEXT);
  CREATE TABLE terminal_themes (id INTEGER PRIMARY KEY, name TEXT, theme_type TEXT);
  CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, details TEXT, timestamp INTEGER);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE appearance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER, updated_at INTEGER);
  INSERT INTO users(id, username) VALUES (3, 'legacy-admin');
  INSERT INTO connections(id, name) VALUES (30, 'legacy-connection');
`);

await runMigrations(db);

assert.deepEqual(
  await get<{ currentVersion: number }>('SELECT MAX(id) AS currentVersion FROM migrations'),
  { currentVersion: 19 },
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

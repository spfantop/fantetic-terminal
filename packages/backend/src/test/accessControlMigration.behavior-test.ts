import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  CREATE TABLE quick_command_tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE quick_command_tag_associations (quick_command_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY(quick_command_id, tag_id));
  CREATE TABLE favorite_paths (id INTEGER PRIMARY KEY, path TEXT);
  CREATE TABLE terminal_themes (
    id INTEGER PRIMARY KEY, name TEXT UNIQUE, theme_type TEXT,
    foreground TEXT, background TEXT, cursor TEXT, cursor_accent TEXT,
    selection_background TEXT, black TEXT, red TEXT, green TEXT, yellow TEXT,
    blue TEXT, magenta TEXT, cyan TEXT, white TEXT, bright_black TEXT,
    bright_red TEXT, bright_green TEXT, bright_yellow TEXT, bright_blue TEXT,
    bright_magenta TEXT, bright_cyan TEXT, bright_white TEXT,
    created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, details TEXT, timestamp INTEGER, actor_user_id INTEGER NULL);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE appearance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER, updated_at INTEGER);
  INSERT INTO users(id, username) VALUES (3, 'legacy-admin');
  INSERT INTO connections(id, name) VALUES (30, 'legacy-connection');
  INSERT INTO quick_commands(id, name) VALUES (40, 'legacy-command');
`);

await runMigrations(db);

assert.deepEqual(
  await get<{ currentVersion: number }>('SELECT MAX(id) AS currentVersion FROM migrations'),
  { currentVersion: 29 },
);
assert.deepEqual(
  await get<{ count: number }>("SELECT COUNT(*) AS count FROM pragma_table_info('audit_logs') WHERE name IN ('request_id','actor_user_id','actor_role','source_ip','asset_id','session_id','result')"),
  { count: 7 },
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
  await get<{ count: number }>(`
    SELECT
      (SELECT COUNT(*) FROM pragma_table_info('command_history') WHERE name = 'owner_user_id') +
      (SELECT COUNT(*) FROM pragma_table_info('path_history') WHERE name = 'owner_user_id') +
      (SELECT COUNT(*) FROM pragma_table_info('quick_commands') WHERE name = 'owner_user_id') +
      (SELECT COUNT(*) FROM pragma_table_info('quick_command_tags') WHERE name = 'owner_user_id') +
      (SELECT COUNT(*) FROM pragma_table_info('favorite_paths') WHERE name = 'owner_user_id') +
      (SELECT COUNT(*) FROM pragma_table_info('terminal_themes') WHERE name = 'owner_user_id') +
      (SELECT COUNT(*) FROM pragma_table_info('audit_logs') WHERE name = 'actor_user_id') AS count
  `),
  { count: 7 },
);
assert.deepEqual(
  await get<{ owner_user_id: number }>('SELECT owner_user_id FROM quick_commands WHERE id = 40'),
  { owner_user_id: 3 },
);
assert.deepEqual(
  await get<{ count: number }>("SELECT COUNT(*) AS count FROM migrations WHERE id = 18"),
  { count: 1 },
);
assert.deepEqual(
  await get<{ count: number }>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name IN ('idx_command_history_owner','idx_path_history_owner','idx_quick_commands_owner','idx_favorite_paths_owner','idx_terminal_themes_owner_type','idx_audit_logs_actor')"),
  { count: 6 },
);
assert.deepEqual(
  await get<{ count: number }>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='user_groups'"),
  { count: 1 },
);
assert.deepEqual(
  await get<{ count: number }>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='session_recordings'"),
  { count: 1 },
);
assert.deepEqual(
  await get<{ count: number }>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='session_recordings' AND sql LIKE '%''RDP''%' AND sql LIKE '%''VNC''%'"),
  { count: 1 },
);
assert.deepEqual(
  await get<{ count: number }>("SELECT COUNT(*) AS count FROM pragma_table_info('session_recordings') WHERE name IN ('recording_chain_hash', 'recording_batch_count')"),
  { count: 2 },
);
assert.deepEqual(
  await get<{ count: number }>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='user_appearance_settings'"),
  { count: 1 },
);
assert.deepEqual(
  await get<{ count: number }>("SELECT COUNT(*) AS count FROM pragma_table_info('audit_logs') WHERE name IN ('previous_hash', 'entry_hash')"),
  { count: 2 },
);
assert.deepEqual(
  await get<{ count: number }>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name IN ('audit_logs_prevent_update', 'audit_logs_prevent_delete')"),
  { count: 2 },
);
assert.deepEqual(
  await get<{ count: number }>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='audit_logs_fts'"),
  { count: 1 },
  'audit search requires an FTS index',
);
await exec("INSERT INTO audit_logs (details, timestamp) VALUES ('legacy deployment incident', 1)");
assert.deepEqual(
  await get<{ count: number }>("SELECT COUNT(*) AS count FROM audit_logs_fts WHERE audit_logs_fts MATCH 'deployment'"),
  { count: 1 },
  'new audit rows must be indexed for full-text search',
);

await exec('DELETE FROM migrations WHERE id = 20');
await runMigrations(db);
assert.deepEqual(
  await get<{ count: number }>('SELECT COUNT(*) AS count FROM migrations WHERE id = 20'),
  { count: 1 },
);

await new Promise<void>((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

const partiallyMigratedDb = new sqlite3.Database(':memory:');
const partialExec = (sql: string) => new Promise<void>((resolve, reject) => {
  partiallyMigratedDb.exec(sql, error => error ? reject(error) : resolve());
});
const partialGet = <T>(sql: string) => new Promise<T>((resolve, reject) => {
  partiallyMigratedDb.get(sql, (error, row: T) => error ? reject(error) : resolve(row));
});

await partialExec(`
  CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
  INSERT INTO migrations(id, name, applied_at) VALUES (22, 'legacy baseline', 0);
  CREATE TABLE users (id INTEGER PRIMARY KEY);
  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY,
    actor_username TEXT NULL,
    actor_user_id INTEGER NULL,
    timestamp INTEGER NOT NULL
  );
`);

await runMigrations(partiallyMigratedDb);
assert.deepEqual(
  await partialGet<{ count: number }>("SELECT COUNT(*) AS count FROM pragma_table_info('audit_logs') WHERE name IN ('request_id','actor_username','actor_role','source_ip','asset_id','session_id','result')"),
  { count: 7 },
  'partially applied multi-column migrations must add every missing column',
);
assert.deepEqual(
  await partialGet<{ count: number }>('SELECT COUNT(*) AS count FROM migrations WHERE id = 23'),
  { count: 1 },
);
assert.deepEqual(
  await partialGet<{ count: number }>("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name IN ('idx_audit_logs_actor_time','idx_audit_logs_asset_time','idx_audit_logs_session','idx_audit_logs_request')"),
  { count: 4 },
);

await new Promise<void>((resolve, reject) => partiallyMigratedDb.close(error => error ? reject(error) : resolve()));

const partiallyMigratedLegacyDb = new sqlite3.Database(':memory:');
const legacyExec = (sql: string) => new Promise<void>((resolve, reject) => {
  partiallyMigratedLegacyDb.exec(sql, error => error ? reject(error) : resolve());
});
const legacyGet = <T>(sql: string) => new Promise<T>((resolve, reject) => {
  partiallyMigratedLegacyDb.get(sql, (error, row: T) => error ? reject(error) : resolve(row));
});

await legacyExec(`
  CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
  INSERT INTO migrations(id, name, applied_at) VALUES
    (8, 'legacy baseline', 0),
    (10, 'already applied', 0),
    (12, 'already applied', 0),
    (14, 'already applied', 0),
    (15, 'already applied', 0),
    (16, 'already applied', 0),
    (17, 'already applied', 0),
    (18, 'already applied', 0),
    (19, 'already applied', 0),
    (20, 'already applied', 0),
    (21, 'already applied', 0),
    (22, 'already applied', 0),
    (23, 'already applied', 0),
    (24, 'already applied', 0),
    (25, 'already applied', 0);
  CREATE TABLE connections (
    id INTEGER PRIMARY KEY,
    jump_chain TEXT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE connection_folders (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO connections(id) VALUES (7);
  INSERT INTO connection_folders(id, name) VALUES (5, 'legacy-folder');
`);

await runMigrations(partiallyMigratedLegacyDb);
assert.deepEqual(
  await legacyGet<{ count: number }>("SELECT COUNT(*) AS count FROM pragma_table_info('connections') WHERE name IN ('jump_chain','proxy_type','folder_id','sort_order')"),
  { count: 4 },
);
assert.deepEqual(
  await legacyGet<{ count: number }>("SELECT COUNT(*) AS count FROM pragma_table_info('connection_folders') WHERE name = 'sort_order'"),
  { count: 1 },
);
assert.deepEqual(
  await legacyGet<{ connectionSortOrder: number; folderSortOrder: number }>(`
    SELECT connections.sort_order AS connectionSortOrder, connection_folders.sort_order AS folderSortOrder
    FROM connections CROSS JOIN connection_folders
  `),
  { connectionSortOrder: 7, folderSortOrder: 5 },
);
assert.deepEqual(
  await legacyGet<{ count: number }>('SELECT COUNT(*) AS count FROM migrations WHERE id IN (9, 11, 13)'),
  { count: 3 },
);

await new Promise<void>((resolve, reject) => partiallyMigratedLegacyDb.close(error => error ? reject(error) : resolve()));

const invalidLegacyDb = new sqlite3.Database(':memory:');
const invalidExec = (sql: string) => new Promise<void>((resolve, reject) => {
  invalidLegacyDb.exec(sql, error => error ? reject(error) : resolve());
});
const invalidGet = <T>(sql: string) => new Promise<T>((resolve, reject) => {
  invalidLegacyDb.get(sql, (error, row: T) => error ? reject(error) : resolve(row));
});

await invalidExec(`
  CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
  INSERT INTO migrations(id, name, applied_at) VALUES
    (8, 'legacy baseline', 0),
    (10, 'already applied', 0), (11, 'already applied', 0), (12, 'already applied', 0),
    (13, 'already applied', 0), (14, 'already applied', 0), (15, 'already applied', 0),
    (16, 'already applied', 0), (17, 'already applied', 0), (18, 'already applied', 0),
    (19, 'already applied', 0), (20, 'already applied', 0), (21, 'already applied', 0),
    (22, 'already applied', 0), (23, 'already applied', 0), (24, 'already applied', 0),
    (25, 'already applied', 0);
`);

await assert.rejects(runMigrations(invalidLegacyDb), /迁移 #9 失败/);
assert.deepEqual(
  await invalidGet<{ count: number }>('SELECT COUNT(*) AS count FROM migrations WHERE id = 9'),
  { count: 0 },
  'failed migrations must not be recorded as applied',
);

await new Promise<void>((resolve, reject) => invalidLegacyDb.close(error => error ? reject(error) : resolve()));

const migrationModule = readFileSync(resolve('src/database/migrations.ts'), 'utf8');
assert.doesNotMatch(migrationModule, /\bconsole\.(?:log|info|warn|error|debug)\b/);

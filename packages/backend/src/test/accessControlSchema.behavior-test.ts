import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';

import {
  createAccessControlTablesSQL,
  migrateLegacyResourcesToAccessControlSQL,
  migrateUserPrivateResourcesSQL,
} from '../access-control/access-control.schema';

const db = new sqlite3.Database(':memory:');
const exec = (sql: string) => new Promise<void>((resolve, reject) => {
  db.exec(sql, (error) => error ? reject(error) : resolve());
});
const all = <T>(sql: string) => new Promise<T[]>((resolve, reject) => {
  db.all(sql, (error, rows: T[]) => error ? reject(error) : resolve(rows));
});

await exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE);
  CREATE TABLE connections (id INTEGER PRIMARY KEY, name TEXT);
  ${createAccessControlTablesSQL}
  INSERT INTO users(id, username) VALUES (1, 'alice'), (2, 'bob');
  INSERT INTO connections(id, name) VALUES (10, 'prod-db');
  INSERT INTO user_groups(id, name, created_by) VALUES (100, 'ops', 1), (101, 'audit', 1);
  INSERT INTO user_group_members(group_id, user_id, role) VALUES
    (100, 1, 'owner'), (100, 2, 'operator'), (101, 2, 'viewer');
  INSERT INTO connection_group_permissions(connection_id, group_id, permission) VALUES
    (10, 100, 'connect'), (10, 101, 'view');
`);

const memberships = await all<{ name: string; role: string }>(`
  SELECT g.name, m.role
  FROM user_group_members m
  JOIN user_groups g ON g.id = m.group_id
  WHERE m.user_id = 2
  ORDER BY g.name
`);
assert.deepEqual(memberships, [
  { name: 'audit', role: 'viewer' },
  { name: 'ops', role: 'operator' },
]);

await assert.rejects(
  exec("INSERT INTO user_group_members(group_id, user_id, role) VALUES (100, 2, 'root')"),
  /CHECK constraint failed/,
);

await assert.rejects(
  exec("INSERT INTO connection_group_permissions(connection_id, group_id, permission) VALUES (10, 100, 'shell')"),
  /CHECK constraint failed/,
);

await new Promise<void>((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

const legacyDb = new sqlite3.Database(':memory:');
const legacyExec = (sql: string) => new Promise<void>((resolve, reject) => {
  legacyDb.exec(sql, (error) => error ? reject(error) : resolve());
});
const legacyGet = <T>(sql: string) => new Promise<T>((resolve, reject) => {
  legacyDb.get(sql, (error, row: T) => error ? reject(error) : resolve(row));
});

await legacyExec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE);
  CREATE TABLE connections (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE proxies (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE ssh_keys (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE connection_folders (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT);
  INSERT INTO users(id, username) VALUES (5, 'existing-admin');
  INSERT INTO connections(id, name) VALUES (20, 'legacy-host');
  ${migrateLegacyResourcesToAccessControlSQL}
`);

assert.deepEqual(
  await legacyGet<{ system_role: string; status: string }>(
    'SELECT system_role, status FROM users WHERE id = 5',
  ),
  { system_role: 'super_admin', status: 'active' },
);
assert.deepEqual(
  await legacyGet<{ owner_user_id: number }>('SELECT owner_user_id FROM connections WHERE id = 20'),
  { owner_user_id: 5 },
);

await new Promise<void>((resolve, reject) => legacyDb.close((error) => error ? reject(error) : resolve()));

const privateDb = new sqlite3.Database(':memory:');
const privateExec = (sql: string) => new Promise<void>((resolve, reject) => {
  privateDb.exec(sql, (error) => error ? reject(error) : resolve());
});
const privateGet = <T>(sql: string) => new Promise<T>((resolve, reject) => {
  privateDb.get(sql, (error, row: T) => error ? reject(error) : resolve(row));
});

await privateExec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE);
  CREATE TABLE command_history (id INTEGER PRIMARY KEY, command TEXT, timestamp INTEGER);
  CREATE TABLE path_history (id INTEGER PRIMARY KEY, path TEXT, timestamp INTEGER);
  CREATE TABLE quick_commands (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE quick_command_tags (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE favorite_paths (id INTEGER PRIMARY KEY, path TEXT);
  CREATE TABLE terminal_themes (id INTEGER PRIMARY KEY, name TEXT, theme_type TEXT);
  CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, details TEXT, timestamp INTEGER);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE appearance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER, updated_at INTEGER);
  INSERT INTO users(id, username) VALUES (4, 'legacy-admin');
  INSERT INTO quick_commands(id, name) VALUES (40, 'deploy');
  INSERT INTO terminal_themes(id, name, theme_type) VALUES
    (1, 'Preset', 'preset'), (2, 'Custom', 'user');
  INSERT INTO settings(key, value) VALUES ('language', 'zh-CN');
  INSERT INTO appearance_settings(key, value) VALUES ('theme', 'dark');
  ${migrateUserPrivateResourcesSQL}
`);

assert.deepEqual(
  await privateGet<{ owner_user_id: number }>('SELECT owner_user_id FROM quick_commands WHERE id = 40'),
  { owner_user_id: 4 },
);
assert.deepEqual(
  await privateGet<{ preset_owner: null; custom_owner: number }>(`
    SELECT
      (SELECT owner_user_id FROM terminal_themes WHERE id = 1) AS preset_owner,
      (SELECT owner_user_id FROM terminal_themes WHERE id = 2) AS custom_owner
  `),
  { preset_owner: null, custom_owner: 4 },
);
assert.deepEqual(
  await privateGet<{ value: string }>("SELECT value FROM user_settings WHERE user_id = 4 AND key = 'language'"),
  { value: 'zh-CN' },
);
assert.deepEqual(
  await privateGet<{ value: string }>("SELECT value FROM user_appearance_settings WHERE user_id = 4 AND key = 'theme'"),
  { value: 'dark' },
);

await new Promise<void>((resolve, reject) => privateDb.close((error) => error ? reject(error) : resolve()));

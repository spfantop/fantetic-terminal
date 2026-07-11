import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';

import {
  createAccessControlTablesSQL,
  migrateLegacyResourcesToAccessControlSQL,
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

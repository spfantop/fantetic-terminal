import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';

import { allDb, getDb, runDb } from '../database/connection';
import { SqliteUserAdministrationRepository } from '../access-control/user-administration.repository';

const db = new sqlite3.Database(':memory:');
await runDb(db, 'PRAGMA foreign_keys = ON');
await runDb(db, `CREATE TABLE users (
  id INTEGER PRIMARY KEY, username TEXT, hashed_password TEXT, system_role TEXT, status TEXT,
  auth_epoch INTEGER DEFAULT 0, created_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0
)`);
await runDb(db, 'CREATE TABLE user_groups (id INTEGER PRIMARY KEY, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL)');
await runDb(db, `CREATE TABLE user_group_members (
  group_id INTEGER, user_id INTEGER, role TEXT, updated_at INTEGER DEFAULT 0,
  PRIMARY KEY(group_id, user_id),
  FOREIGN KEY(group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
)`);
for (const table of ['connections', 'proxies', 'ssh_keys', 'connection_folders']) {
  await runDb(db, `CREATE TABLE ${table} (id INTEGER PRIMARY KEY, owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL)`);
}
await runDb(db, `CREATE TABLE tags (
  id INTEGER PRIMARY KEY, name TEXT, owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
)`);
await runDb(db, 'CREATE UNIQUE INDEX ux_tags_owner_name ON tags(owner_user_id, name)');
await runDb(db, `CREATE TABLE connection_tags (
  connection_id INTEGER, tag_id INTEGER, PRIMARY KEY(connection_id, tag_id),
  FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE,
  FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
)`);
await runDb(db, `CREATE TABLE command_history (
  id INTEGER PRIMARY KEY, owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
)`);

await runDb(db, `INSERT INTO users(id, username, hashed_password, system_role, status) VALUES
  (1, 'departing', 'x', 'user', 'active'), (2, 'receiver', 'x', 'user', 'active')`);
await runDb(db, 'INSERT INTO user_groups(id, created_by) VALUES (10, 1)');
await runDb(db, "INSERT INTO user_group_members(group_id, user_id, role) VALUES (10, 1, 'owner'), (10, 2, 'member')");
await runDb(db, 'INSERT INTO connections(id, owner_user_id) VALUES (20, 1)');
await runDb(db, "INSERT INTO tags(id, name, owner_user_id) VALUES (30, 'production', 1), (31, 'production', 2)");
await runDb(db, 'INSERT INTO connection_tags(connection_id, tag_id) VALUES (20, 30)');
await runDb(db, 'INSERT INTO command_history(id, owner_user_id) VALUES (40, 1)');

const repository = new SqliteUserAdministrationRepository(async () => db);
await repository.deleteUser(1, 2);

assert.equal(await getDb(db, 'SELECT id FROM users WHERE id = 1'), undefined);
assert.equal((await getDb<any>(db, 'SELECT owner_user_id FROM connections WHERE id = 20'))?.owner_user_id, 2);
assert.equal((await getDb<any>(db, 'SELECT role FROM user_group_members WHERE group_id = 10 AND user_id = 2'))?.role, 'owner');
assert.equal((await getDb<any>(db, 'SELECT created_by FROM user_groups WHERE id = 10'))?.created_by, null);
assert.deepEqual(await allDb(db, 'SELECT id FROM command_history'), []);
assert.deepEqual(await allDb<any>(db, 'SELECT id, owner_user_id FROM tags'), [{ id: 31, owner_user_id: 2 }]);
assert.deepEqual(await allDb<any>(db, 'SELECT connection_id, tag_id FROM connection_tags'), [{ connection_id: 20, tag_id: 31 }]);

await new Promise<void>((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

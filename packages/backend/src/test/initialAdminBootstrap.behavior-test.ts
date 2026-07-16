import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';

import { createInitialAdministrator } from '../auth/initial-admin-bootstrap';

const db = new sqlite3.Database(':memory:');

await new Promise<void>((resolve, reject) => db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    hashed_password TEXT NOT NULL,
    system_role TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`, error => error ? reject(error) : resolve()));

const resultList = await Promise.all(
  Array.from({ length: 20 }, (_, index) => createInitialAdministrator(db, {
    username: `admin-${index}`,
    hashedPassword: `hash-${index}`,
    now: 1_700_000_000 + index,
  })),
);

assert.equal(resultList.filter(result => result.created).length, 1);
assert.equal(resultList.filter(result => !result.created).length, 19);

const userCount = await new Promise<number>((resolve, reject) => db.get(
  'SELECT COUNT(*) AS count FROM users',
  (error, row: { count: number }) => error ? reject(error) : resolve(row.count),
));
assert.equal(userCount, 1);

const superAdminCount = await new Promise<number>((resolve, reject) => db.get(
  "SELECT COUNT(*) AS count FROM users WHERE system_role = 'super_admin'",
  (error, row: { count: number }) => error ? reject(error) : resolve(row.count),
));
assert.equal(superAdminCount, 1);

await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

console.log('initial administrator bootstrap behavior passed');

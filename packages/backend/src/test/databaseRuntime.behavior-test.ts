import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sqlite3 from 'sqlite3';

import { configureDatabaseRuntime, getDb, runDb } from '../database/connection';

const db = new sqlite3.Database(':memory:');
await configureDatabaseRuntime(db);

assert.equal((await getDb<any>(db, 'PRAGMA foreign_keys'))?.foreign_keys, 1);
assert.equal((await getDb<any>(db, 'PRAGMA busy_timeout'))?.timeout, 5000);
assert.equal((await getDb<any>(db, 'PRAGMA synchronous'))?.synchronous, 1);

const errors: string[] = [];
const originalConsoleError = console.error;
console.error = (...values: unknown[]) => { errors.push(values.map(String).join(' ')); };
try {
  await assert.rejects(runDb(db, 'INSERT INTO missing_table(secret) VALUES (?)', ['do-not-log-this-secret']));
} finally {
  console.error = originalConsoleError;
}
assert.equal(errors.some(message => message.includes('do-not-log-this-secret')), false);
assert.equal(errors.some(message => message.includes('参数数量: 1')), true);

const connectionModule = readFileSync(resolve('src/database/connection.ts'), 'utf8');
assert.doesNotMatch(connectionModule, /\bconsole\.(?:log|info|warn|error|debug)\b/);

await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

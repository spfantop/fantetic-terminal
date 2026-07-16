import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';

import { allDb, runDb, withTransaction } from '../database/connection';

const db = new sqlite3.Database(':memory:');
await runDb(db, 'CREATE TABLE events (value TEXT NOT NULL)');

let releaseFirst!: () => void;
const firstBarrier = new Promise<void>(resolve => { releaseFirst = resolve; });
let markFirstEntered!: () => void;
const firstEntered = new Promise<void>(resolve => { markFirstEntered = resolve; });
const enteredTransactionList: string[] = [];

const first = withTransaction(db, async transactionDb => {
  enteredTransactionList.push('first');
  markFirstEntered();
  await runDb(transactionDb, 'INSERT INTO events(value) VALUES (?)', ['first']);
  await firstBarrier;
});
const second = withTransaction(db, async transactionDb => {
  enteredTransactionList.push('second');
  await runDb(transactionDb, 'INSERT INTO events(value) VALUES (?)', ['second']);
});

await firstEntered;
assert.deepEqual(enteredTransactionList, ['first'], 'same-database callbacks must not interleave');
releaseFirst();
await Promise.all([first, second]);
assert.deepEqual(enteredTransactionList, ['first', 'second']);
assert.deepEqual(await allDb<{ value: string }>(db, 'SELECT value FROM events ORDER BY rowid'), [
  { value: 'first' },
  { value: 'second' },
]);

const businessError = new Error('business operation failed');
await assert.rejects(
  withTransaction(db, async transactionDb => {
    await runDb(transactionDb, 'INSERT INTO events(value) VALUES (?)', ['rolled-back']);
    throw businessError;
  }),
  error => error === businessError,
);
assert.deepEqual(await allDb<{ value: string }>(db, 'SELECT value FROM events ORDER BY rowid'), [
  { value: 'first' },
  { value: 'second' },
]);

await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
console.log('database transaction behavior ok');

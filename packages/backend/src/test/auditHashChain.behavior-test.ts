import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';

import { AuditLogRepository, verifyAuditLogChain } from '../audit/audit.repository';
import { allDb, runDb } from '../database/connection';

const db = new sqlite3.Database(':memory:');
await runDb(db, `CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  details TEXT NULL,
  request_id TEXT NULL,
  actor_user_id INTEGER NULL,
  actor_username TEXT NULL,
  actor_role TEXT NULL,
  source_ip TEXT NULL,
  asset_id INTEGER NULL,
  session_id TEXT NULL,
  result TEXT NOT NULL DEFAULT 'success',
  previous_hash TEXT NULL,
  entry_hash TEXT NULL
)`);
await runDb(db, `CREATE TRIGGER audit_logs_prevent_update
  BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs are append-only'); END`);
await runDb(db, `CREATE TRIGGER audit_logs_prevent_delete
  BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs are append-only'); END`);

const repository = new AuditLogRepository({
  getDatabase: async () => db,
  now: () => 0,
  reportCleanupFailure: () => undefined,
});
await repository.addLog('LOGIN_SUCCESS', { username: 'alice' });
await repository.addLog('USER_DELETED', { targetUserId: 7 });

assert.deepEqual(await verifyAuditLogChain(db), {
  valid: true,
  checkedEntries: 2,
  legacyEntries: 0,
});
await assert.rejects(
  runDb(db, "UPDATE audit_logs SET details = 'tampered' WHERE id = 1"),
  /append-only/,
  'normal database writes must not modify audit records',
);
await assert.rejects(
  runDb(db, 'DELETE FROM audit_logs WHERE id = 1'),
  /append-only/,
  'normal database writes must not delete audit records',
);

await runDb(db, 'DROP TRIGGER audit_logs_prevent_update');
await runDb(db, "UPDATE audit_logs SET details = 'tampered' WHERE id = 1");
assert.deepEqual(await verifyAuditLogChain(db), {
  valid: false,
  checkedEntries: 1,
  legacyEntries: 0,
  error: 'entry hash mismatch at audit log 1',
}, 'offline tampering of one record must be detected');

await runDb(db, 'DROP TRIGGER audit_logs_prevent_delete');
await runDb(db, 'DELETE FROM audit_logs');
await repository.addLog('LOGIN_SUCCESS', { username: 'alice' });
await repository.addLog('USER_DELETED', { targetUserId: 7 });
await runDb(db, "UPDATE audit_logs SET previous_hash = 'broken' WHERE id = 4");
assert.deepEqual(await verifyAuditLogChain(db), {
  valid: false,
  checkedEntries: 2,
  legacyEntries: 0,
  error: 'previous hash mismatch at audit log 4',
}, 'a broken hash link must be detected');

await runDb(db, 'DELETE FROM audit_logs');
await runDb(db, `INSERT INTO audit_logs(timestamp, action_type, details, result)
  VALUES (1, 'LOGIN_SUCCESS', '{"legacy":true}', 'success')`);
await repository.addLog('LOGIN_SUCCESS', { username: 'modern' });
const rows = await allDb<{ previous_hash: string | null; entry_hash: string | null }>(
  db,
  'SELECT previous_hash, entry_hash FROM audit_logs ORDER BY id',
);
assert.equal(rows[0].entry_hash, null, 'historical rows remain readable without rewriting');
assert.equal(rows[1].previous_hash, null, 'the first signed entry starts a new chain after legacy data');
assert.deepEqual(await verifyAuditLogChain(db), {
  valid: true,
  checkedEntries: 1,
  legacyEntries: 1,
});

await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
console.log('audit hash chain behavior ok');

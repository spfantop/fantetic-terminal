import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';

import {
  clearPendingTwoFactorSetup,
  createPendingTwoFactorSetup,
  createTwoFactorQrCodeDataUrl,
  readPendingTwoFactorSecret,
  readTwoFactorSecret,
} from '../auth/two-factor-security';

process.env.ENCRYPTION_KEY = '11'.repeat(32);

const db = new sqlite3.Database(':memory:');
await new Promise<void>((resolve, reject) => db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    two_factor_secret TEXT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO users(id, two_factor_secret) VALUES (1, 'LEGACYBASE32SECRET');
`, error => error ? reject(error) : resolve()));

const legacySecret = await readTwoFactorSecret(db, 1, 'LEGACYBASE32SECRET');
assert.equal(legacySecret, 'LEGACYBASE32SECRET');
const migratedRow = await new Promise<{ two_factor_secret: string }>((resolve, reject) => {
  db.get('SELECT two_factor_secret FROM users WHERE id = 1', (error, row: { two_factor_secret: string }) => (
    error ? reject(error) : resolve(row)
  ));
});
assert.notEqual(migratedRow.two_factor_secret, 'LEGACYBASE32SECRET');
assert.match(migratedRow.two_factor_secret, /^enc:v1:/);
assert.equal(await readTwoFactorSecret(db, 1, migratedRow.two_factor_secret), 'LEGACYBASE32SECRET');

const session: Record<string, unknown> = {};
createPendingTwoFactorSetup(session, 'PENDINGSECRET', 1_000);
assert.equal(readPendingTwoFactorSecret(session, 1_000), 'PENDINGSECRET');
assert.equal(readPendingTwoFactorSecret(session, 1_000 + 10 * 60_000 + 1), undefined);
assert.equal(session.tempTwoFactorSecret, undefined);
assert.equal(session.tempTwoFactorSecretExpiresAt, undefined);

createPendingTwoFactorSetup(session, 'CANCELLEDSECRET', 2_000);
clearPendingTwoFactorSetup(session);
assert.equal(readPendingTwoFactorSecret(session, 2_000), undefined);

await assert.rejects(
  createTwoFactorQrCodeDataUrl('otpauth://example', (_value, callback) => callback(new Error('qr failed'))),
  /qr failed/,
);

await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

console.log('two factor security behavior ok');

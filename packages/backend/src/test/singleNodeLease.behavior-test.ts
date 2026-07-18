import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { acquireSingleNodeLease } from '../config/single-node-lease';

const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-single-node-'));
const firstLease = acquireSingleNodeLease({ appDataPath, enabled: true, instanceId: 'first' });
assert.equal(firstLease.enabled, true);
assert.throws(
  () => acquireSingleNodeLease({ appDataPath, enabled: true, instanceId: 'second' }),
  /already owns the shared data directory/,
);
firstLease.release();

const replacementLease = acquireSingleNodeLease({ appDataPath, enabled: true, instanceId: 'replacement' });
replacementLease.release();

const staleOwnerLease = acquireSingleNodeLease({
  appDataPath,
  enabled: true,
  instanceId: 'stale-owner',
  heartbeatIntervalMs: 60_000,
  staleAfterMs: 30_000,
});
const lockPath = path.join(appDataPath, 'runtime', 'single-node.lock');
const staleLock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { heartbeatAt: number };
staleLock.heartbeatAt = Date.now() - 31_000;
fs.writeFileSync(lockPath, JSON.stringify(staleLock), 'utf8');

const takeoverLease = acquireSingleNodeLease({
  appDataPath,
  enabled: true,
  instanceId: 'takeover',
  heartbeatIntervalMs: 60_000,
  staleAfterMs: 30_000,
});
staleOwnerLease.release();
assert.equal(fs.existsSync(lockPath), true, 'an expired owner must not remove the replacement lease');
takeoverLease.release();

fs.mkdirSync(path.dirname(lockPath), { recursive: true });
fs.writeFileSync(lockPath, JSON.stringify({
  instanceId: 'crashed-owner',
  leaseToken: 'crashed-token',
  pid: process.pid,
  startedAt: Date.now() - 60_000,
  heartbeatAt: Date.now() - 60_000,
}), 'utf8');
const crashRecoveryLease = acquireSingleNodeLease({
  appDataPath,
  enabled: true,
  instanceId: 'crash-recovery',
});
crashRecoveryLease.release();

const disabledLease = acquireSingleNodeLease({ appDataPath, enabled: false, instanceId: 'disabled' });
assert.equal(disabledLease.enabled, false);
assert.equal(fs.existsSync(path.join(appDataPath, 'runtime', 'single-node.lock')), false);

fs.rmSync(appDataPath, { recursive: true, force: true });
console.log('single node lease behavior passed');

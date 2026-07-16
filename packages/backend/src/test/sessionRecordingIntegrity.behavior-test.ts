import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveSessionRecordingIntegrity } from '../session-recording/recording-integrity';

assert.deepEqual(resolveSessionRecordingIntegrity(
  { recording_chain_hash: 'a'.repeat(64), recording_batch_count: 2 },
  { status: 'valid', eventCount: 3, batchCount: 2, finalHash: 'a'.repeat(64) },
), { status: 'valid', eventCount: 3, batchCount: 2 });

assert.deepEqual(resolveSessionRecordingIntegrity(
  { recording_chain_hash: 'a'.repeat(64), recording_batch_count: 2 },
  { status: 'valid', eventCount: 3, batchCount: 1, finalHash: 'a'.repeat(64) },
), { status: 'invalid', eventCount: 3, batchCount: 1, reason: 'index-mismatch' });

assert.deepEqual(resolveSessionRecordingIntegrity(
  { recording_chain_hash: null, recording_batch_count: 0 },
  { status: 'legacy', eventCount: 1, batchCount: 1, finalHash: null },
), { status: 'legacy', eventCount: 1, batchCount: 1 });

const migrations = readFileSync(resolve('src/database/migrations.ts'), 'utf8');
const repository = readFileSync(resolve('src/session-recording/session-recording.repository.ts'), 'utf8');
const service = readFileSync(resolve('src/session-recording/session-recording.service.ts'), 'utf8');
assert.match(migrations, /id:\s*29[\s\S]*recording_chain_hash[\s\S]*recording_batch_count/);
assert.match(repository, /recording_chain_hash, recording_batch_count/);
assert.match(service, /verifyRecordingIntegrity\(/);
assert.match(service, /integrity\.status === 'invalid'/);

console.log('session recording integrity behavior ok');

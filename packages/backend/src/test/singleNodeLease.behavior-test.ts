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

const disabledLease = acquireSingleNodeLease({ appDataPath, enabled: false, instanceId: 'disabled' });
assert.equal(disabledLease.enabled, false);
assert.equal(fs.existsSync(path.join(appDataPath, 'runtime', 'single-node.lock')), false);

fs.rmSync(appDataPath, { recursive: true, force: true });
console.log('single node lease behavior passed');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildTransferSshConnectConfig } from '../transfers/ssh-connect-config';

const passwordConfig = buildTransferSshConnectConfig(
  { host: 'source.internal', port: 2222, username: 'alice', auth_method: 'password' },
  { decryptedPassword: 'password-value' },
);
assert.equal(passwordConfig.host, 'source.internal');
assert.equal(passwordConfig.port, 2222);
assert.equal(passwordConfig.username, 'alice');
assert.equal(passwordConfig.password, 'password-value');
assert.equal(passwordConfig.privateKey, undefined);
assert.equal(passwordConfig.readyTimeout, 20_000);
assert.equal(passwordConfig.keepaliveInterval, 10_000);

const keyConfig = buildTransferSshConnectConfig(
  { host: 'target.internal', port: 0, username: 'bob', auth_method: 'key' },
  { decryptedPrivateKey: 'private-key-value', decryptedPassphrase: 'passphrase-value' },
);
assert.equal(keyConfig.port, 22, 'empty or zero ports should preserve the existing default port behavior');
assert.equal(keyConfig.privateKey, 'private-key-value');
assert.equal(keyConfig.passphrase, 'passphrase-value');
assert.equal(keyConfig.password, undefined);

const transfersServiceSource = readFileSync(resolve('src/transfers/transfers.service.ts'), 'utf8');
assert.match(
  transfersServiceSource,
  /buildTransferSshConnectConfig\(/,
  'transfer orchestration should delegate SSH configuration to the dedicated module',
);
assert.doesNotMatch(
  transfersServiceSource,
  /private buildSshConnectConfig\(/,
  'the duplicate SSH configuration builder must not remain in TransfersService',
);

console.log('transfer SSH connect config behavior passed');

import assert from 'node:assert/strict';
import {
  mergeSshTestConnectionDetails,
  type SshTestConnectionDetails,
} from '../services/connection-test-overrides';

const savedDetails: SshTestConnectionDetails = {
  host: '172.16.0.110',
  port: 22,
  username: 'wrong-user',
  auth_method: 'password',
  password: 'saved-password',
  privateKey: undefined,
  passphrase: undefined,
};

const correctedDetails = mergeSshTestConnectionDetails(savedDetails, {
  host: '172.16.0.110',
  port: 22,
  username: 'correct-user',
  auth_method: 'password',
});
assert.equal(correctedDetails.username, 'correct-user');
assert.equal(correctedDetails.password, 'saved-password');

const explicitlyChangedPassword = mergeSshTestConnectionDetails(savedDetails, {
  username: 'correct-user',
  password: '',
});
assert.equal(explicitlyChangedPassword.password, '');

console.log('connection test overrides behavior ok');

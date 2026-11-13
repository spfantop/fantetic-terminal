import assert from 'node:assert/strict';
import {
  buildConnectionTestRequest,
  type ConnectionTestFormData,
} from '../src/features/connections/connection-test-request';

const editedFormData: ConnectionTestFormData = {
  type: 'SSH',
  host: '172.16.0.110',
  port: 22,
  username: 'correct-user',
  auth_method: 'password',
  password: '',
  proxy_id: null,
  selected_ssh_key_id: null,
};

const editedRequest = buildConnectionTestRequest(editedFormData, 7);
assert.equal(editedRequest.endpoint, '/connections/7/test');
assert.equal(editedRequest.data.username, 'correct-user');
assert.equal(editedRequest.data.host, '172.16.0.110');
assert.equal(editedRequest.data.port, 22);
assert.equal(editedRequest.data.password, undefined);

const unsavedRequest = buildConnectionTestRequest({
  ...editedFormData,
  username: 'new-user',
}, null);
assert.equal(unsavedRequest.endpoint, '/connections/test-unsaved');
assert.equal(unsavedRequest.data.username, 'new-user');

const keyRequest = buildConnectionTestRequest({
  ...editedFormData,
  auth_method: 'key',
  username: 'key-user',
  selected_ssh_key_id: 12,
}, 7);
assert.equal(keyRequest.data.auth_method, 'key');
assert.equal(keyRequest.data.ssh_key_id, 12);

console.log('connection test request behavior ok');

import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = '11'.repeat(32);

const { decodeNotificationConfig, encodeNotificationConfig } = await import('../notifications/notification.repository');

const config = { smtpUser: 'ops', smtpPass: 'very-secret', headers: { Authorization: 'Bearer token' } };
const encrypted = encodeNotificationConfig(config);

assert.match(encrypted, /^enc:v1:/);
assert.doesNotMatch(encrypted, /very-secret|Bearer token/);
assert.deepEqual(decodeNotificationConfig(encrypted), config);
assert.deepEqual(decodeNotificationConfig(JSON.stringify(config)), config, 'Legacy plaintext JSON remains readable');
const originalConsoleError = console.error;
console.error = () => undefined;
try {
  assert.throws(() => decodeNotificationConfig('enc:v1:not-valid-ciphertext'));
} finally {
  console.error = originalConsoleError;
}

console.log('notification config encryption ok');

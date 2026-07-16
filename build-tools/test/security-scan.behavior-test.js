const assert = require('node:assert/strict');

const { scanText } = require('../security-scan');

assert.deepEqual(scanText('README.md', 'ENCRYPTION_KEY=${ENCRYPTION_KEY:-}'), []);
assert.deepEqual(scanText('config.ts', "const sample = 'ghp_short';"), []);
assert.deepEqual(
  scanText('secret.pem', ['-----BEGIN', 'PRIVATE KEY-----\nabc\n-----END', 'PRIVATE KEY-----'].join(' ')),
  [{ file: 'secret.pem', kind: 'private-key' }],
);
assert.deepEqual(
  scanText('config.env', `AWS_ACCESS_KEY_ID=${['AKIA', 'IOSFODNN7EXAMPLE'].join('')}`),
  [{ file: 'config.env', kind: 'aws-access-key' }],
);

console.log('secret scan behavior checks passed');

import assert from 'node:assert/strict';

import { createClientIpResolver } from '../config/client-ip';
import { isIpWhitelistEnabled } from '../config/ip-whitelist';

const resolver = createClientIpResolver('127.0.0.1/8,172.16.0.0/12,fd00::/8');

assert.equal(
  resolver.resolve({ remoteAddress: '203.0.113.10', forwardedFor: '127.0.0.1' }),
  '203.0.113.10',
  'An untrusted direct client must not spoof its address with X-Forwarded-For',
);

assert.equal(
  resolver.resolve({ remoteAddress: '172.18.0.3', forwardedFor: '198.51.100.20' }),
  '198.51.100.20',
  'A trusted reverse proxy must expose the original client address',
);

assert.equal(
  resolver.resolve({
    remoteAddress: '172.18.0.3',
    forwardedFor: '198.51.100.20, 172.18.0.2',
  }),
  '198.51.100.20',
  'A trusted proxy chain must resolve the first untrusted hop from the server side',
);

assert.equal(resolver.isTrustedProxy('::ffff:127.0.0.1'), true);

assert.equal(isIpWhitelistEnabled('false'), false);
assert.equal(isIpWhitelistEnabled('true'), true);

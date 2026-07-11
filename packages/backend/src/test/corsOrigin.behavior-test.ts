import assert from 'node:assert/strict';

import { isCorsOriginAllowed, parseCorsOrigins, readForwardedHost } from '../config/cors-origin';

const configuredOrigins = new Set(['https://terminal.example.com']);

assert.equal(
  isCorsOriginAllowed('http://192.168.1.20:18111', configuredOrigins, 'http://192.168.1.20:18111'),
  true,
  'Docker reverse-proxy requests from the public frontend origin must be allowed',
);

assert.equal(
  isCorsOriginAllowed('https://terminal.example.com', configuredOrigins, 'http://192.168.1.20:18111'),
  true,
  'Explicitly configured origins must remain allowed',
);

assert.equal(
  isCorsOriginAllowed('https://attacker.example', configuredOrigins, 'http://192.168.1.20:18111'),
  false,
  'Unrelated credentialed cross-origin requests must remain blocked',
);

assert.equal(
  isCorsOriginAllowed(undefined, configuredOrigins, 'http://192.168.1.20:18111'),
  true,
  'Non-browser requests without an Origin header must remain supported',
);

assert.deepEqual(
  [...parseCorsOrigins('https://one.example, https://two.example/path', 'not-a-url')],
  ['https://one.example', 'https://two.example'],
  'Configured origins must be normalized and invalid entries ignored',
);

assert.equal(
  readForwardedHost('terminal.example:18111, internal-proxy'),
  'terminal.example:18111',
  'Only the client-facing forwarded host, including its port, must be used',
);

assert.equal(
  isCorsOriginAllowed('null', configuredOrigins, 'http://192.168.1.20:18111'),
  false,
  'Opaque browser origins must not be accepted for credentialed requests',
);

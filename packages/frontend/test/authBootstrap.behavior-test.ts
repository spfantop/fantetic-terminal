import assert from 'node:assert/strict';

import { classifyAuthBootstrapFailure } from '../src/utils/authBootstrap';

assert.equal(
  classifyAuthBootstrapFailure({ response: { status: 401 } }),
  'unauthenticated',
  'an explicit 401 means the visitor is unauthenticated',
);
assert.equal(
  classifyAuthBootstrapFailure({ response: { status: 503 } }),
  'unavailable',
  'a server failure must not be presented as a logged-out session',
);
assert.equal(
  classifyAuthBootstrapFailure({ request: {} }),
  'unavailable',
  'a network failure must remain retryable',
);

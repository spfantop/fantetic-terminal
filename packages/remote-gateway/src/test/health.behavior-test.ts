import assert from 'node:assert/strict';

import { createHealthSnapshot } from '../health';

assert.deepEqual(
  createHealthSnapshot({ guacamoleReady: true }),
  { status: 'ready', checks: { guacamole: 'ready' } },
);

assert.deepEqual(
  createHealthSnapshot({ guacamoleReady: false }),
  { status: 'not_ready', checks: { guacamole: 'not_ready' } },
);

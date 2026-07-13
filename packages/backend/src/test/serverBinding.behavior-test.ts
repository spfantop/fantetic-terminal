import assert from 'node:assert/strict';

import { resolveServerBinding } from '../config/server-binding';

assert.deepEqual(
  resolveServerBinding({ appMode: 'electron', host: undefined, port: '22458' }),
  { host: '127.0.0.1', port: 22458 },
  'Electron mode must default to a loopback-only binding',
);

assert.throws(
  () => resolveServerBinding({ appMode: 'electron', host: '0.0.0.0', port: '22458' }),
  /loopback/i,
  'Electron mode must reject non-loopback bindings',
);

assert.deepEqual(
  resolveServerBinding({ appMode: 'web', host: undefined, port: '3001' }),
  { host: '0.0.0.0', port: 3001 },
  'Web/container mode must remain reachable through its network adapter',
);

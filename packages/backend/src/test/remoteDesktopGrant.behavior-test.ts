import assert from 'node:assert/strict';

import { RemoteDesktopGrantRegistry } from '../websocket/remote-desktop-grant';

let now = 1000;
const grants = new RemoteDesktopGrantRegistry({ ttlMs: 5000, maxEntries: 10, now: () => now });
grants.register('secret-token', 1, 42);
assert.equal(grants.consume('secret-token', 2), undefined);
assert.deepEqual(grants.consume('secret-token', 1), { connectionId: 42 });
assert.equal(grants.consume('secret-token', 1), undefined);
grants.register('expired-token', 1, 43);
now = 6001;
assert.equal(grants.consume('expired-token', 1), undefined);

console.log('remote desktop grant behavior ok');

import assert from 'node:assert/strict';

import { readOwnedClientState } from '../websocket/session-access';

const ownerSocket = { userId: 1 } as any;
const sameUserOtherSocket = { userId: 1 } as any;
const otherUserSocket = { userId: 2 } as any;
const state = { ws: ownerSocket } as any;
const states = new Map([['session-1', state]]);

assert.equal(readOwnedClientState(states, ownerSocket, 'session-1'), state);
assert.equal(readOwnedClientState(states, sameUserOtherSocket, 'session-1'), undefined);
assert.equal(readOwnedClientState(states, otherUserSocket, 'session-1'), undefined);
assert.equal(readOwnedClientState(states, ownerSocket, 'missing'), undefined);

console.log('websocket session ownership behavior ok');

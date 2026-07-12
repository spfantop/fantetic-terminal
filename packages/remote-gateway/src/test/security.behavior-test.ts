import assert from 'node:assert/strict';

import { createGatewayTokenClaims, GatewayTokenReplayGuard, isAuthorizedGatewayRequest } from '../security';

assert.equal(isAuthorizedGatewayRequest('shared-secret-value-with-32-characters', 'shared-secret-value-with-32-characters'), true);
assert.equal(isAuthorizedGatewayRequest('wrong', 'shared-secret-value-with-32-characters'), false);
assert.equal(isAuthorizedGatewayRequest(undefined, 'shared-secret-value-with-32-characters'), false);

const claims = createGatewayTokenClaims({ now: 1_000, ttlMs: 30_000, nonce: 'nonce-1234567890' });
assert.deepEqual(claims, { expiresAt: 31_000, nonce: 'nonce-1234567890' });

const guard = new GatewayTokenReplayGuard(() => 10_000);
assert.doesNotThrow(() => guard.consume({ expiresAt: 20_000, nonce: 'nonce-1234567890' }));
assert.throws(() => guard.consume({ expiresAt: 20_000, nonce: 'nonce-1234567890' }), /already used/i);
assert.throws(() => guard.consume({ expiresAt: 9_999, nonce: 'nonce-expired-123' }), /expired/i);
assert.throws(() => guard.consume({ expiresAt: 100_000, nonce: 'nonce-too-far-123' }), /invalid expiration/i);

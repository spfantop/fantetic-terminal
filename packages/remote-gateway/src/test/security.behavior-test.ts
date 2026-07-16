import assert from 'node:assert/strict';

import { createGatewayTokenClaims, GatewayTokenReplayGuard, isAuthorizedGatewayRequest } from '../security';
import { decryptGatewayToken, encryptGatewayToken } from '../token';

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

const encryptionKey = Buffer.alloc(32, 7);
const tokenPayload = JSON.stringify({ expiresAt: 20_000, nonce: 'nonce-authenticated-123' });
const authenticatedToken = encryptGatewayToken(tokenPayload, encryptionKey);
assert.equal(decryptGatewayToken(authenticatedToken, encryptionKey), tokenPayload);

const tamperTokenField = (token: string, field: 'iv' | 'value' | 'tag'): string => {
  const envelope = JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as Record<string, string>;
  const bytes = Buffer.from(envelope[field], 'base64');
  bytes[0] ^= 1;
  envelope[field] = bytes.toString('base64');
  return Buffer.from(JSON.stringify(envelope)).toString('base64');
};

for (const field of ['iv', 'value', 'tag'] as const) {
  assert.throws(
    () => decryptGatewayToken(tamperTokenField(authenticatedToken, field), encryptionKey),
    /invalid gateway token/i,
  );
}

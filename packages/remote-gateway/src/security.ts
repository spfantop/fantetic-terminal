import crypto from 'crypto';

export type GatewayTokenClaims = {
  expiresAt: number;
  nonce: string;
};

const MAX_TOKEN_FUTURE_MS = 60_000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{12,128}$/;

export const isAuthorizedGatewayRequest = (provided: string | undefined, expected: string): boolean => {
  if (!provided || !expected) return false;
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
};

export const createGatewayTokenClaims = ({
  now = Date.now(),
  ttlMs = 30_000,
  nonce = crypto.randomBytes(18).toString('base64url'),
}: {
  now?: number;
  ttlMs?: number;
  nonce?: string;
} = {}): GatewayTokenClaims => ({ expiresAt: now + ttlMs, nonce });

export class GatewayTokenReplayGuard {
  private readonly usedNonceExpirations = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 10_000,
  ) {}

  consume(claims: GatewayTokenClaims): void {
    const now = this.now();
    for (const [nonce, expiration] of this.usedNonceExpirations) {
      if (expiration < now) this.usedNonceExpirations.delete(nonce);
    }
    if (!Number.isFinite(claims.expiresAt) || claims.expiresAt > now + MAX_TOKEN_FUTURE_MS) {
      throw new Error('Invalid expiration.');
    }
    if (claims.expiresAt <= now) throw new Error('Token expired.');
    if (!NONCE_PATTERN.test(claims.nonce)) throw new Error('Invalid token nonce.');
    if (this.usedNonceExpirations.has(claims.nonce)) throw new Error('Token already used.');
    if (this.usedNonceExpirations.size >= this.maxEntries) throw new Error('Token replay cache capacity exceeded.');
    this.usedNonceExpirations.set(claims.nonce, claims.expiresAt);
  }
}

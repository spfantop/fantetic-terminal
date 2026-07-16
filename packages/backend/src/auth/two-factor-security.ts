import type sqlite3 from 'sqlite3';

import { runDb } from '../database/connection';
import { decrypt, encrypt } from '../utils/crypto';

const ENCRYPTED_SECRET_PREFIX = 'enc:v1:';
const PENDING_SETUP_TTL_MS = 10 * 60_000;

type PendingTwoFactorSession = {
  tempTwoFactorSecret?: string;
  tempTwoFactorSecretExpiresAt?: number;
};

type QrCodeCallback = (error: Error | null | undefined, dataUrl?: string) => void;
type QrCodeEncoder = (value: string, callback: QrCodeCallback) => void;

export const protectTwoFactorSecret = (secret: string): string => (
  `${ENCRYPTED_SECRET_PREFIX}${encrypt(secret)}`
);

export const readTwoFactorSecret = async (
  db: sqlite3.Database,
  userId: number,
  storedSecret: string,
): Promise<string> => {
  if (storedSecret.startsWith(ENCRYPTED_SECRET_PREFIX)) {
    return decrypt(storedSecret.slice(ENCRYPTED_SECRET_PREFIX.length));
  }

  const protectedSecret = protectTwoFactorSecret(storedSecret);
  await runDb(
    db,
    `UPDATE users
     SET two_factor_secret = ?, updated_at = strftime('%s', 'now')
     WHERE id = ? AND two_factor_secret = ?`,
    [protectedSecret, userId, storedSecret],
  );
  return storedSecret;
};

export const createPendingTwoFactorSetup = (
  session: PendingTwoFactorSession,
  secret: string,
  now = Date.now(),
): void => {
  session.tempTwoFactorSecret = secret;
  session.tempTwoFactorSecretExpiresAt = now + PENDING_SETUP_TTL_MS;
};

export const clearPendingTwoFactorSetup = (session: PendingTwoFactorSession): void => {
  delete session.tempTwoFactorSecret;
  delete session.tempTwoFactorSecretExpiresAt;
};

export const readPendingTwoFactorSecret = (
  session: PendingTwoFactorSession,
  now = Date.now(),
): string | undefined => {
  const secret = session.tempTwoFactorSecret;
  const expiresAt = session.tempTwoFactorSecretExpiresAt;
  if (!secret || !expiresAt || expiresAt <= now) {
    clearPendingTwoFactorSetup(session);
    return undefined;
  }
  return secret;
};

export const createTwoFactorQrCodeDataUrl = (
  otpauthUrl: string,
  encode: QrCodeEncoder,
): Promise<string> => new Promise((resolve, reject) => {
  encode(otpauthUrl, (error, dataUrl) => {
    if (error) {
      reject(error);
      return;
    }
    if (!dataUrl) {
      reject(new Error('生成二维码未返回数据。'));
      return;
    }
    resolve(dataUrl);
  });
});

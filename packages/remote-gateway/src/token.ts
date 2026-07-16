import crypto from 'crypto';

type GatewayTokenEnvelope = {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  value: string;
  tag: string;
};

const TOKEN_ALGORITHM = 'aes-256-gcm';
const TOKEN_VERSION = 1;
const TOKEN_IV_BYTES = 12;
const TOKEN_KEY_BYTES = 32;

const assertValidKey = (key: Buffer): void => {
  if (key.length !== TOKEN_KEY_BYTES) {
    throw new Error('Gateway token key must contain exactly 32 bytes.');
  }
};

export const encryptGatewayToken = (data: string, key: Buffer): string => {
  assertValidKey(key);
  const iv = crypto.randomBytes(TOKEN_IV_BYTES);
  const cipher = crypto.createCipheriv(TOKEN_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const envelope: GatewayTokenEnvelope = {
    version: TOKEN_VERSION,
    algorithm: TOKEN_ALGORITHM,
    iv: iv.toString('base64'),
    value: encrypted.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
};

export const decryptGatewayToken = (token: string, key: Buffer): string => {
  try {
    assertValidKey(key);
    const envelope = JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as Partial<GatewayTokenEnvelope>;
    if (envelope.version !== TOKEN_VERSION || envelope.algorithm !== TOKEN_ALGORITHM) {
      throw new Error('Unsupported gateway token format.');
    }
    if (typeof envelope.iv !== 'string' || typeof envelope.value !== 'string' || typeof envelope.tag !== 'string') {
      throw new Error('Incomplete gateway token.');
    }
    const iv = Buffer.from(envelope.iv, 'base64');
    const encrypted = Buffer.from(envelope.value, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (iv.length !== TOKEN_IV_BYTES || tag.length !== 16 || encrypted.length === 0) {
      throw new Error('Invalid gateway token encoding.');
    }
    const decipher = crypto.createDecipheriv(TOKEN_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    // 对外保持稳定错误，避免通过错误差异泄露令牌格式或认证细节。
    throw new Error('Invalid gateway token.');
  }
};

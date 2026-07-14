import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type RuntimeSecretInput = {
  nodeEnv?: string;
  appMode?: string;
  deploymentMode?: string;
  encryptionKey?: string;
  sessionSecret?: string;
  gatewaySharedSecret?: string;
  randomHex?: (bytes: number) => string;
};

export type ResolvedRuntimeSecrets = {
  encryptionKey: string;
  sessionSecret: string;
  gatewaySharedSecret: string;
  generated: boolean;
  generatedValues: Record<string, string>;
};

const isValidEncryptionKey = (value?: string): value is string => /^[a-f0-9]{64}$/i.test(value ?? '');
const isValidSessionSecret = (value?: string): value is string => (value?.length ?? 0) >= 32;

export const resolveRuntimeSecrets = (input: RuntimeSecretInput): ResolvedRuntimeSecrets => {
  const productionWeb = input.nodeEnv === 'production' && input.appMode !== 'electron';
  const allowDockerGeneration = input.deploymentMode === 'docker';
  const missingOrInvalid: string[] = [];
  if (!isValidEncryptionKey(input.encryptionKey)) missingOrInvalid.push('ENCRYPTION_KEY');
  if (!isValidSessionSecret(input.sessionSecret)) missingOrInvalid.push('SESSION_SECRET');
  if (productionWeb && !isValidSessionSecret(input.gatewaySharedSecret)) {
    missingOrInvalid.push('REMOTE_GATEWAY_SHARED_SECRET');
  }

  if (productionWeb && !allowDockerGeneration && missingOrInvalid.length > 0) {
    throw new Error(`Missing or invalid production secrets: ${missingOrInvalid.join(', ')}.`);
  }

  const randomHex = input.randomHex ?? ((bytes: number) => crypto.randomBytes(bytes).toString('hex'));
  const generatedValues: Record<string, string> = {};
  const encryptionKey = isValidEncryptionKey(input.encryptionKey)
    ? input.encryptionKey
    : (generatedValues.ENCRYPTION_KEY = randomHex(32));
  const sessionSecret = isValidSessionSecret(input.sessionSecret)
    ? input.sessionSecret
    : (generatedValues.SESSION_SECRET = randomHex(64));
  const gatewaySharedSecret = isValidSessionSecret(input.gatewaySharedSecret)
    ? input.gatewaySharedSecret
    : allowDockerGeneration
      ? (generatedValues.REMOTE_GATEWAY_SHARED_SECRET = randomHex(64))
      : '';

  return {
    encryptionKey,
    sessionSecret,
    gatewaySharedSecret,
    generated: Object.keys(generatedValues).length > 0,
    generatedValues,
  };
};

export const updateEnvDocument = (current: string, values: Record<string, string>): string => {
  const pending = new Map(Object.entries(values));
  const targetKeys = new Set(pending.keys());
  const output: string[] = [];
  for (const line of current.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (!match || !targetKeys.has(match[1])) {
      output.push(line);
      continue;
    }
    if (pending.get(match[1]) !== undefined) {
      output.push(`${match[1]}=${pending.get(match[1])}`);
      pending.delete(match[1]);
    }
  }
  while (output.length > 0 && output[output.length - 1] === '') output.pop();
  for (const [key, value] of pending) output.push(`${key}=${value}`);
  return `${output.join('\n')}\n`;
};

export const persistRuntimeSecrets = (envFilePath: string, values: Record<string, string>): void => {
  if (Object.keys(values).length === 0) return;
  fs.mkdirSync(path.dirname(envFilePath), { recursive: true });
  const current = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
  const temporaryPath = `${envFilePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, updateEnvDocument(current, values), { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(temporaryPath, envFilePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
};

export const initializeRuntimeSecrets = (envFilePath: string): ResolvedRuntimeSecrets => {
  const resolved = resolveRuntimeSecrets({
    nodeEnv: process.env.NODE_ENV,
    appMode: process.env.FANTETIC_APP_MODE,
    deploymentMode: process.env.DEPLOYMENT_MODE,
    encryptionKey: process.env.ENCRYPTION_KEY,
    sessionSecret: process.env.SESSION_SECRET,
    gatewaySharedSecret: process.env.REMOTE_GATEWAY_SHARED_SECRET,
  });
  persistRuntimeSecrets(envFilePath, resolved.generatedValues);
  process.env.ENCRYPTION_KEY = resolved.encryptionKey;
  process.env.SESSION_SECRET = resolved.sessionSecret;
  if (resolved.gatewaySharedSecret) {
    process.env.REMOTE_GATEWAY_SHARED_SECRET = resolved.gatewaySharedSecret;
  }
  return resolved;
};

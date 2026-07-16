import type { ConnectConfig } from 'ssh2';

import type { ConnectionWithTags, DecryptedConnectionCredentials } from '../types/connection.types';

type TransferSshConnection = Pick<ConnectionWithTags, 'host' | 'port' | 'username' | 'auth_method'>;
type TransferSshCredentials = Pick<
  DecryptedConnectionCredentials,
  'decryptedPassword' | 'decryptedPrivateKey' | 'decryptedPassphrase'
>;

/** Builds the ssh2 configuration shared by source and target transfer sessions. */
export const buildTransferSshConnectConfig = (
  connectionInfo: TransferSshConnection,
  credentials: TransferSshCredentials,
): ConnectConfig => {
  const config: ConnectConfig = {
    host: connectionInfo.host,
    port: connectionInfo.port || 22,
    username: connectionInfo.username,
    readyTimeout: 20_000,
    keepaliveInterval: 10_000,
  };

  if (connectionInfo.auth_method === 'password' && credentials.decryptedPassword) {
    config.password = credentials.decryptedPassword;
  } else if (connectionInfo.auth_method === 'key' && credentials.decryptedPrivateKey) {
    config.privateKey = credentials.decryptedPrivateKey;
    if (credentials.decryptedPassphrase) {
      config.passphrase = credentials.decryptedPassphrase;
    }
  }
  return config;
};

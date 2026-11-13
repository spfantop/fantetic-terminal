export interface SshTestConnectionDetails {
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'key';
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface SshTestConnectionOverrides {
  host?: string;
  port?: number;
  username?: string;
  auth_method?: 'password' | 'key';
  password?: string;
  private_key?: string;
  passphrase?: string;
  ssh_key_id?: number | null;
  proxy_id?: number | null;
}

const hasOwn = <Key extends PropertyKey>(
  value: object,
  key: Key,
): value is object & Record<Key, unknown> => Object.prototype.hasOwnProperty.call(value, key);

export const mergeSshTestConnectionDetails = (
  savedDetails: SshTestConnectionDetails,
  overrides?: SshTestConnectionOverrides,
): SshTestConnectionDetails => {
  if (!overrides) return { ...savedDetails };

  const mergedDetails: SshTestConnectionDetails = {
    ...savedDetails,
    host: overrides.host ?? savedDetails.host,
    port: overrides.port ?? savedDetails.port,
    username: overrides.username ?? savedDetails.username,
    auth_method: overrides.auth_method ?? savedDetails.auth_method,
  };

  if (overrides.auth_method === 'password') {
    mergedDetails.privateKey = undefined;
    mergedDetails.passphrase = undefined;
  } else if (overrides.auth_method === 'key') {
    mergedDetails.password = undefined;
  }

  if (hasOwn(overrides, 'password')) {
    mergedDetails.password = overrides.password;
  }
  if (hasOwn(overrides, 'private_key')) {
    mergedDetails.privateKey = overrides.private_key;
  }
  if (hasOwn(overrides, 'passphrase')) {
    mergedDetails.passphrase = overrides.passphrase;
  }

  return mergedDetails;
};

import type { ConnectionFolderInfo, ConnectionInfo } from './connection-catalog.types';

export class InvalidConnectionCatalogError extends Error {
  constructor(endpoint: string) {
    super(`Invalid catalog response from ${endpoint}`);
    this.name = 'InvalidConnectionCatalogError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isOptional = <Value>(value: unknown, isValue: (candidate: unknown) => candidate is Value): value is Value | undefined => (
  value === undefined || isValue(value)
);

const isOptionalNullable = <Value>(value: unknown, isValue: (candidate: unknown) => candidate is Value): value is Value | null | undefined => (
  value === undefined || value === null || isValue(value)
);

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumberList = (value: unknown): value is number[] => Array.isArray(value) && value.every(isNumber);
const isNullableNumber = (value: unknown): value is number | null => value === null || isNumber(value);
const isConnectionType = (value: unknown): value is ConnectionInfo['type'] => (
  value === 'SSH' || value === 'RDP' || value === 'VNC' || value === 'TELNET'
);
const isAuthMethod = (value: unknown): value is ConnectionInfo['auth_method'] => (
  value === 'password' || value === 'key'
);

const isConnectionInfo = (value: unknown): value is ConnectionInfo => {
  if (!isRecord(value)) return false;
  return isNumber(value.id)
    && isString(value.name)
    && isConnectionType(value.type)
    && isString(value.host)
    && isNumber(value.port)
    && isString(value.username)
    && isAuthMethod(value.auth_method)
    && isNumber(value.created_at)
    && isNumber(value.updated_at)
    && isNullableNumber(value.last_connected_at)
    && isOptionalNullable(value.proxy_id, isNumber)
    && isOptionalNullable(value.proxy_type, candidate => candidate === 'proxy' || candidate === 'jump')
    && isOptionalNullable(value.folder_id, isNumber)
    && isOptionalNullable(value.icon, isString)
    && isOptional(value.sort_order, isNumber)
    && isOptional(value.tag_ids, isNumberList)
    && isOptionalNullable(value.ssh_key_id, isNumber)
    && isOptionalNullable(value.notes, isString)
    && isOptional(value.vncPassword, isString)
    && isOptionalNullable(value.jump_chain, isNumberList)
    && isOptional(value.effective_permission, candidate => (
      candidate === 'view' || candidate === 'connect' || candidate === 'manage'
    ));
};

const isConnectionFolderInfo = (value: unknown): value is ConnectionFolderInfo => {
  if (!isRecord(value)) return false;
  return isNumber(value.id)
    && isString(value.name)
    && isOptionalNullable(value.parent_id, isNumber)
    && isNumber(value.sort_order)
    && isNumber(value.created_at)
    && isNumber(value.updated_at);
};

const decodeList = <Item>(
  value: unknown,
  endpoint: string,
  isItem: (candidate: unknown) => candidate is Item,
): Item[] => {
  if (!Array.isArray(value) || !value.every(isItem)) throw new InvalidConnectionCatalogError(endpoint);
  return value;
};

const decodeItem = <Item>(
  value: unknown,
  endpoint: string,
  isItem: (candidate: unknown) => candidate is Item,
): Item => {
  if (!isItem(value)) throw new InvalidConnectionCatalogError(endpoint);
  return value;
};

export const decodeConnection = (value: unknown): ConnectionInfo => (
  decodeItem(value, '/connections/:id', isConnectionInfo)
);

export const decodeConnectionFolder = (value: unknown): ConnectionFolderInfo => (
  decodeItem(value, '/connections/folders/:id', isConnectionFolderInfo)
);

export const decodeConnectionList = (value: unknown): ConnectionInfo[] => (
  decodeList(value, '/connections', isConnectionInfo)
);

export const decodeConnectionFolderList = (value: unknown): ConnectionFolderInfo[] => (
  decodeList(value, '/connections/folders', isConnectionFolderInfo)
);

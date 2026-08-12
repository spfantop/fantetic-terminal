import apiClient from '../../utils/apiClient';
import { readUserCacheScope } from '../../utils/userCacheScope';
import { createConnectionCatalogCache } from './connection-catalog.cache';
import {
  decodeConnectionFolderList,
  decodeConnectionList,
  InvalidConnectionCatalogError,
} from './connection-catalog.decoder';
import type { ConnectionFolderInfo, ConnectionInfo } from './connection-catalog.types';
import {
  createManagedConnectionCatalog,
  type ManagedConnectionCatalog,
} from './managed-connection-catalog';

export interface ManagedConnectionCatalogProjection {
  connections: ConnectionInfo[];
  folders: ConnectionFolderInfo[];
  isLoading: boolean;
  isFoldersLoading: boolean;
  error: string | null;
}

export interface ManagedConnectionCatalogSet {
  connections: ManagedConnectionCatalog<ConnectionInfo>;
  folders: ManagedConnectionCatalog<ConnectionFolderInfo>;
}

const catalogSetByProjection = new WeakMap<ManagedConnectionCatalogProjection, ManagedConnectionCatalogSet>();

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const resolveCatalogError = (error: unknown, fallback: string): string => {
  if (error instanceof InvalidConnectionCatalogError) return fallback;
  const errorRecord = isRecord(error) ? error : null;
  const response = isRecord(errorRecord?.response) ? errorRecord.response : null;
  const data = isRecord(response?.data) ? response.data : null;
  if (typeof data?.message === 'string') return data.message;
  if (typeof errorRecord?.message === 'string') return errorRecord.message;
  return fallback;
};

const createStoreCatalog = <Item>({
  projection,
  cacheKey,
  endpoint,
  decode,
  replace,
  setLoading,
  fallbackError,
}: {
  projection: ManagedConnectionCatalogProjection;
  cacheKey: string;
  endpoint: string;
  decode: (value: unknown) => Item[];
  replace: (itemList: Item[]) => void;
  setLoading: (value: boolean) => void;
  fallbackError: string;
}): ManagedConnectionCatalog<Item> => createManagedConnectionCatalog({
  getScope: () => readUserCacheScope(localStorage),
  cache: createConnectionCatalogCache(
    localStorage,
    cacheKey,
    decode,
    (operation, error) => {
      console.error(`[ConnectionsStore] Failed to ${operation} ${cacheKey}:`, error);
    },
  ),
  readRemote: async () => decode((await apiClient.get<unknown>(endpoint)).data),
  projection: {
    replace,
    setLoading,
    setError: error => {
      if (error !== null) console.error(`[ConnectionsStore] Failed to refresh ${endpoint}:`, error);
      projection.error = error === null ? null : resolveCatalogError(error, fallbackError);
    },
  },
});

export const getManagedConnectionCatalogSet = (
  projection: ManagedConnectionCatalogProjection,
): ManagedConnectionCatalogSet => {
  const existing = catalogSetByProjection.get(projection);
  if (existing) return existing;

  const catalogSet: ManagedConnectionCatalogSet = {
    connections: createStoreCatalog({
      projection,
      cacheKey: 'connectionsCache',
      endpoint: '/connections',
      decode: decodeConnectionList,
      replace: itemList => { projection.connections = itemList; },
      setLoading: value => { projection.isLoading = value; },
      fallbackError: '获取连接列表时发生未知错误。',
    }),
    folders: createStoreCatalog({
      projection,
      cacheKey: 'connectionFoldersCache',
      endpoint: '/connections/folders',
      decode: decodeConnectionFolderList,
      replace: itemList => { projection.folders = itemList; },
      setLoading: value => { projection.isFoldersLoading = value; },
      fallbackError: '获取连接文件夹列表时发生未知错误。',
    }),
  };
  catalogSetByProjection.set(projection, catalogSet);
  return catalogSet;
};

export type ConnectionCatalogCacheOperation = 'read' | 'write' | 'remove';

interface ConnectionCatalogStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ConnectionCatalogCache<Item> {
  read(): Item[] | null;
  write(itemList: Item[]): void;
  remove(): void;
}

export const createConnectionCatalogCache = <Item>(
  storage: ConnectionCatalogStorage,
  cacheKey: string,
  decode: (value: unknown) => Item[],
  reportError: (operation: ConnectionCatalogCacheOperation, error: unknown) => void,
): ConnectionCatalogCache<Item> => {
  const remove = (): void => {
    try {
      storage.removeItem(cacheKey);
    } catch (error) {
      reportError('remove', error);
    }
  };

  const read = (): Item[] | null => {
    try {
      const cachedValue = storage.getItem(cacheKey);
      if (!cachedValue) return null;
      return decode(JSON.parse(cachedValue));
    } catch (error) {
      reportError('read', error);
      remove();
      return null;
    }
  };

  const write = (itemList: Item[]): void => {
    try {
      storage.setItem(cacheKey, JSON.stringify(itemList));
    } catch (error) {
      reportError('write', error);
    }
  };

  return { read, write, remove };
};

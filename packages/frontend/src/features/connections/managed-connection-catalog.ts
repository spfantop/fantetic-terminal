export interface ManagedConnectionCatalogAdapter<Item> {
  getScope(): string | null;
  cache: {
    read(): Item[] | null;
    write(itemList: Item[]): void;
    remove(): void;
  };
  readRemote(): Promise<Item[]>;
  projection: {
    replace(itemList: Item[]): void;
    setLoading(value: boolean): void;
    setError(error: unknown): void;
  };
}

export interface ManagedConnectionCatalog<Item> {
  refresh(): Promise<void>;
  revalidate(): Promise<void>;
  invalidate(): void;
  replace(itemList: Item[]): void;
}

export const createManagedConnectionCatalog = <Item>(
  adapter: ManagedConnectionCatalogAdapter<Item>,
): ManagedConnectionCatalog<Item> => {
  let inFlight: { scope: string | null; promise: Promise<void> } | null = null;
  let activeGeneration = 0;
  let activeScope: string | null | undefined;
  let projectionSnapshot: string | null = null;

  const replaceProjection = (itemList: Item[]): void => {
    const nextSnapshot = JSON.stringify(itemList);
    if (nextSnapshot === projectionSnapshot) return;
    projectionSnapshot = nextSnapshot;
    adapter.projection.replace(itemList);
  };

  const refresh = (): Promise<void> => {
    const scope = adapter.getScope();
    if (inFlight?.scope === scope) return inFlight.promise;
    if (activeScope !== scope) {
      activeScope = scope;
      projectionSnapshot = null;
      replaceProjection([]);
    }
    const generation = activeGeneration + 1;
    activeGeneration = generation;

    adapter.projection.setError(null);
    const cachedItemList = adapter.cache.read();
    if (cachedItemList) replaceProjection(cachedItemList);
    adapter.projection.setLoading(true);

    let remoteRead: Promise<Item[]>;
    try {
      remoteRead = adapter.readRemote();
    } catch (error) {
      remoteRead = Promise.reject(error);
    }

    const promise = remoteRead
      .then(itemList => {
        if (generation !== activeGeneration || adapter.getScope() !== scope) return;
        replaceProjection(itemList);
        adapter.cache.write(itemList);
        adapter.projection.setError(null);
      })
      .catch(error => {
        if (generation !== activeGeneration || adapter.getScope() !== scope) return;
        adapter.projection.setError(error);
      })
      .finally(() => {
        if (inFlight?.promise !== promise) return;
        inFlight = null;
        adapter.projection.setLoading(false);
      });
    inFlight = { scope, promise };
    return promise;
  };

  const invalidate = (): void => {
    activeGeneration += 1;
    inFlight = null;
    projectionSnapshot = null;
    adapter.cache.remove();
    adapter.projection.setLoading(false);
  };

  const replace = (itemList: Item[]): void => {
    invalidate();
    replaceProjection(itemList);
    adapter.cache.write(itemList);
    adapter.projection.setError(null);
  };

  const revalidate = (): Promise<void> => {
    invalidate();
    return refresh();
  };

  return { refresh, revalidate, invalidate, replace };
};

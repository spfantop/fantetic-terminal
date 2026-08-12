import assert from 'node:assert/strict';

import {
  createManagedConnectionCatalog,
  type ManagedConnectionCatalogAdapter,
} from '../src/features/connections/managed-connection-catalog';
import {
  decodeConnectionFolderList,
  decodeConnectionList,
  InvalidConnectionCatalogError,
} from '../src/features/connections/connection-catalog.decoder';
import { createConnectionCatalogCache } from '../src/features/connections/connection-catalog.cache';
import type { ConnectionInfo } from '../src/features/connections/connection-catalog.types';

interface CatalogItem {
  id: number;
  name: string;
}

let scope = 'web:1';
let itemList: CatalogItem[] = [];
let loading = false;
let error: unknown = null;
let remoteReadCount = 0;
let projectionReplaceCount = 0;
const remoteResolverList: Array<(itemList: CatalogItem[]) => void> = [];
const cachedWriteList: CatalogItem[][] = [];

const adapter: ManagedConnectionCatalogAdapter<CatalogItem> = {
  getScope: () => scope,
  cache: {
    read: () => null,
    write: nextItemList => { cachedWriteList.push(nextItemList); },
    remove: () => undefined,
  },
  readRemote: () => {
    remoteReadCount += 1;
    return new Promise(resolvePromise => {
      remoteResolverList.push(resolvePromise);
    });
  },
  projection: {
    replace: nextItemList => {
      projectionReplaceCount += 1;
      itemList = nextItemList;
    },
    setLoading: value => { loading = value; },
    setError: value => { error = value; },
  },
};

const catalog = createManagedConnectionCatalog(adapter);
const firstRefresh = catalog.refresh();
const overlappingRefresh = catalog.refresh();

assert.equal(firstRefresh, overlappingRefresh, 'overlapping reads in one scope must share one promise');
assert.equal(remoteReadCount, 1, 'overlapping reads in one scope must issue one remote read');
assert.equal(loading, true);

remoteResolverList.shift()?.([{ id: 1, name: 'production' }]);
await Promise.all([firstRefresh, overlappingRefresh]);

assert.deepEqual(itemList, [{ id: 1, name: 'production' }]);
assert.equal(loading, false);
assert.equal(error, null);

const previousScopeRefresh = catalog.refresh();
scope = 'web:2';
const currentScopeRefresh = catalog.refresh();
assert.notEqual(previousScopeRefresh, currentScopeRefresh, 'a new scope must start an independent read');
assert.equal(remoteReadCount, 3);
assert.deepEqual(itemList, [], 'a new scope must not retain the previous scope projection while loading');

remoteResolverList.splice(1, 1)[0]?.([{ id: 2, name: 'current-user' }]);
await currentScopeRefresh;
remoteResolverList.shift()?.([{ id: 1, name: 'previous-user' }]);
await previousScopeRefresh;

assert.deepEqual(itemList, [{ id: 2, name: 'current-user' }], 'a previous scope must not overwrite the current projection');
assert.deepEqual(cachedWriteList.at(-1), [{ id: 2, name: 'current-user' }], 'a previous scope must not overwrite the current cache');

const preMutationRefresh = catalog.refresh();
catalog.replace([{ id: 3, name: 'created-locally' }]);
remoteResolverList.shift()?.([{ id: 2, name: 'before-mutation' }]);
await preMutationRefresh;
assert.deepEqual(itemList, [{ id: 3, name: 'created-locally' }], 'an invalidated read must not overwrite mutation state');
assert.deepEqual(cachedWriteList.at(-1), [{ id: 3, name: 'created-locally' }]);

const postMutationRefresh = catalog.refresh();
assert.equal(remoteReadCount, 5, 'the first post-mutation refresh must issue a new remote read');
remoteResolverList.shift()?.([{ id: 3, name: 'created-remotely' }]);
await postMutationRefresh;
assert.deepEqual(itemList, [{ id: 3, name: 'created-remotely' }]);

const readStartedDuringMutation = catalog.refresh();
const authoritativeRefresh = catalog.revalidate();
assert.notEqual(readStartedDuringMutation, authoritativeRefresh, 'write completion must not reuse a read started during the mutation');
assert.equal(remoteReadCount, 7);
remoteResolverList.splice(1, 1)[0]?.([{ id: 4, name: 'after-mutation' }]);
await authoritativeRefresh;
remoteResolverList.shift()?.([{ id: 3, name: 'stale-during-mutation' }]);
await readStartedDuringMutation;
assert.deepEqual(itemList, [{ id: 4, name: 'after-mutation' }]);

const replaceCountBeforeUnchangedRead = projectionReplaceCount;
const unchangedRefresh = catalog.refresh();
remoteResolverList.shift()?.([{ id: 4, name: 'after-mutation' }]);
await unchangedRefresh;
assert.equal(projectionReplaceCount, replaceCountBeforeUnchangedRead, 'an unchanged snapshot must not replace the projection');

const cachedFallback: CatalogItem[] = [{ id: 5, name: 'cached-fallback' }];
let fallbackItems: CatalogItem[] = [];
let fallbackLoading = false;
let fallbackError: unknown = null;
const failingCatalog = createManagedConnectionCatalog<CatalogItem>({
  getScope: () => 'web:2',
  cache: {
    read: () => cachedFallback,
    write: () => undefined,
    remove: () => undefined,
  },
  readRemote: async () => { throw new Error('network unavailable'); },
  projection: {
    replace: nextItemList => { fallbackItems = nextItemList; },
    setLoading: value => { fallbackLoading = value; },
    setError: value => { fallbackError = value; },
  },
});
await failingCatalog.refresh();
assert.deepEqual(fallbackItems, cachedFallback, 'a remote error must retain the cached projection');
assert.equal(fallbackLoading, false);
assert.match(String(fallbackError), /network unavailable/);

const validConnection: ConnectionInfo = {
  id: 10,
  name: 'validated',
  type: 'SSH',
  host: 'example.test',
  port: 22,
  username: 'root',
  auth_method: 'password',
  created_at: 1,
  updated_at: 2,
  last_connected_at: null,
  tag_ids: [1, 2],
};
assert.deepEqual(decodeConnectionList([validConnection]), [validConnection]);
assert.throws(
  () => decodeConnectionList([{ ...validConnection, auth_method: 'token' }]),
  InvalidConnectionCatalogError,
);
assert.throws(
  () => decodeConnectionList([{ ...validConnection, tag_ids: null }]),
  InvalidConnectionCatalogError,
);
assert.throws(
  () => decodeConnectionList([{ ...validConnection, last_connected_at: undefined }]),
  InvalidConnectionCatalogError,
);
assert.equal(decodeConnectionFolderList([{
  id: 1,
  name: 'folder',
  parent_id: null,
  sort_order: 0,
  created_at: 1,
  updated_at: 1,
}]).length, 1);
assert.throws(
  () => decodeConnectionFolderList([{ id: 1, name: 'incomplete' }]),
  InvalidConnectionCatalogError,
);

const cacheErrorList: unknown[] = [];
const failingStorage = {
  getItem: () => '{invalid-json',
  setItem: () => { throw new Error('quota exceeded'); },
  removeItem: () => { throw new Error('storage denied'); },
};
const resilientCache = createConnectionCatalogCache(
  failingStorage,
  'connectionsCache',
  decodeConnectionList,
  (_operation, error) => { cacheErrorList.push(error); },
);
assert.equal(resilientCache.read(), null, 'invalid cached data must not escape the cache adapter');
assert.doesNotThrow(() => resilientCache.write([validConnection]), 'cache writes must not block authoritative data');
assert.doesNotThrow(() => resilientCache.remove(), 'cache invalidation must not block mutations');
assert.equal(cacheErrorList.length, 4, 'decode, cleanup, write, and removal failures must remain observable');

console.log('managed connection catalog behavior passed');

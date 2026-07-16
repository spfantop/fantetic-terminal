import assert from 'node:assert/strict';

import {
  activateUserCacheScope,
  clearUserCacheScope,
  readUserScopedItem,
  writeUserScopedItem,
} from '../src/utils/userCacheScope';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const storage = new MemoryStorage();
storage.setItem('connectionsCache', '[{"id":1}]');
storage.setItem('fantetic.debug.enabled', 'true');
assert.equal(activateUserCacheScope(storage, 'web:1'), true);
assert.equal(storage.getItem('connectionsCache'), null, 'first authenticated scope must reject legacy unscoped data');
storage.setItem('connectionsCache', '[{"id":2}]');
assert.equal(activateUserCacheScope(storage, 'web:1'), false);
assert.notEqual(storage.getItem('connectionsCache'), null, 'same user may reuse its current cache');
assert.equal(activateUserCacheScope(storage, 'web:2'), true);
assert.equal(storage.getItem('connectionsCache'), null, 'switching users must clear previous user data');
assert.equal(storage.getItem('fantetic.debug.enabled'), 'true', 'non-user diagnostics must remain untouched');
clearUserCacheScope(storage);
assert.equal(storage.getItem('fantetic.cacheOwner'), null);

activateUserCacheScope(storage, 'web:1');
writeUserScopedItem(storage, 'connections_view_filter_folder', 'folder-1');
writeUserScopedItem(storage, 'connections_view_filter_tags', '["tag-1"]');
assert.equal(readUserScopedItem(storage, 'connections_view_filter_folder'), 'folder-1');
assert.equal(storage.getItem('connections_view_filter_folder'), null, 'business state must not use an unscoped key');

activateUserCacheScope(storage, 'web:2');
assert.equal(readUserScopedItem(storage, 'connections_view_filter_folder'), null, 'switching users must clear resource filters');
assert.equal(readUserScopedItem(storage, 'connections_view_filter_tags'), null, 'switching users must clear resource tag filters');

storage.setItem('dashboard_connections_filter_tag', '7');
assert.equal(readUserScopedItem(storage, 'dashboard_connections_filter_tag'), '7', 'legacy filters must migrate for the active user');
assert.equal(storage.getItem('dashboard_connections_filter_tag'), null, 'legacy keys must be removed after migration');

const CACHE_OWNER_KEY = 'fantetic.cacheOwner';
const USER_STORAGE_PREFIX = 'fantetic.userData.';

const USER_STORAGE_KEYS = new Set([
  'auth',
  'connectionsCache',
  'connectionFoldersCache',
  'tagsCache',
  'commandHistoryCache',
  'dashboardAuditLogsCache',
  'quickCommandsListCache',
  'quickCommandTagsCache',
  'quickCommandsExpandedGroups',
  'favoritePathSortBy',
  'sessionOrder',
  'fantetic_terminal_layout_config',
  'fantetic_terminal_sidebar_config',
  'fantetic_quickCommandRowSizeMultiplier',
  'fantetic_quickCommandsCompactMode',
]);

const isUserStorageKey = (key: string): boolean => USER_STORAGE_KEYS.has(key)
  || key.endsWith('Cache')
  || key.startsWith('fantetic_terminal_')
  || key.startsWith('quickCommands');

const clearUserData = (storage: Storage): void => {
  const keyList = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => Boolean(key));
  keyList.forEach(key => {
    if (isUserStorageKey(key) || key.startsWith(USER_STORAGE_PREFIX)) storage.removeItem(key);
  });
};

const readCurrentScope = (storage: Storage): string | null => storage.getItem(CACHE_OWNER_KEY);

const scopedKey = (scope: string, key: string): string => (
  `${USER_STORAGE_PREFIX}${encodeURIComponent(scope)}.${key}`
);

export const readUserScopedItem = (storage: Storage, key: string): string | null => {
  const scope = readCurrentScope(storage);
  if (!scope) return null;

  const targetKey = scopedKey(scope, key);
  const scopedValue = storage.getItem(targetKey);
  if (scopedValue !== null) return scopedValue;

  const legacyValue = storage.getItem(key);
  if (legacyValue === null) return null;
  storage.setItem(targetKey, legacyValue);
  storage.removeItem(key);
  return legacyValue;
};

export const writeUserScopedItem = (storage: Storage, key: string, value: string): void => {
  const scope = readCurrentScope(storage);
  if (!scope) return;
  storage.setItem(scopedKey(scope, key), value);
};

export const removeUserScopedItem = (storage: Storage, key: string): void => {
  const scope = readCurrentScope(storage);
  if (!scope) return;
  storage.removeItem(scopedKey(scope, key));
};

export const activateUserCacheScope = (storage: Storage, scope: string): boolean => {
  if (storage.getItem(CACHE_OWNER_KEY) === scope) return false;
  clearUserData(storage);
  storage.setItem(CACHE_OWNER_KEY, scope);
  return true;
};

export const clearUserCacheScope = (storage: Storage): void => {
  clearUserData(storage);
  storage.removeItem(CACHE_OWNER_KEY);
};

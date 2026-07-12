const CACHE_OWNER_KEY = 'fantetic.cacheOwner';

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
    if (isUserStorageKey(key)) storage.removeItem(key);
  });
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

const DEBUG_LOG_STORAGE_KEY = 'fantetic_debug_logs';
const DEBUG_LOG_CACHE_TTL_MS = 1000;

let cachedDebugLogEnabled = false;
let hasLoadedDebugLogPreference = false;
let lastDebugLogPreferenceReadAt = 0;

const readDebugLogPreference = () => {
  if (typeof localStorage === 'undefined') return false;

  return localStorage.getItem(DEBUG_LOG_STORAGE_KEY) === 'true';
};

export const isDebugLogEnabled = () => {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

  if (!hasLoadedDebugLogPreference || now - lastDebugLogPreferenceReadAt > DEBUG_LOG_CACHE_TTL_MS) {
    cachedDebugLogEnabled = readDebugLogPreference();
    hasLoadedDebugLogPreference = true;
    lastDebugLogPreferenceReadAt = now;
  }

  return cachedDebugLogEnabled;
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== DEBUG_LOG_STORAGE_KEY) return;

    cachedDebugLogEnabled = event.newValue === 'true';
    hasLoadedDebugLogPreference = true;
    lastDebugLogPreferenceReadAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  });
}

export const debugLog = (...args: unknown[]) => {
  if (!isDebugLogEnabled()) return;

  console.log(...args);
};

export const debugLogLazy = (readArgs: () => unknown[]) => {
  if (!isDebugLogEnabled()) return;

  console.log(...readArgs());
};
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPinia, setActivePinia } from 'pinia';

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: 'layout-runtime-test' },
});

const storedValueByKey = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storedValueByKey.get(key) ?? null,
    setItem: (key: string, value: string) => storedValueByKey.set(key, value),
    removeItem: (key: string) => storedValueByKey.delete(key),
  },
});
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    location: { protocol: 'https:', host: 'terminal.example.test' },
    localStorage,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  },
});

const { default: apiClient } = await import('../src/utils/apiClient');
const constructionRequestUrlList: string[] = [];
apiClient.defaults.adapter = async config => {
  constructionRequestUrlList.push(config.url ?? '');
  return {
    data: null,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
};

const { useLayoutStore } = await import('../src/stores/layout.store');
const readLayoutId = (store: ReturnType<typeof useLayoutStore>): string | undefined => (
  store.layoutTree?.id
);
setActivePinia(createPinia());
useLayoutStore();

assert.deepEqual(
  constructionRequestUrlList,
  [],
  'constructing the layout store must not start remote initialization',
);

type DeferredResponse = {
  resolve: (data: unknown) => void;
};

const initializationRequestUrlList: string[] = [];
const deferredResponseByUrl = new Map<string, DeferredResponse>();
apiClient.defaults.adapter = config => new Promise(resolve => {
  const url = config.url ?? '';
  initializationRequestUrlList.push(url);
  deferredResponseByUrl.set(url, {
    resolve: data => resolve({
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }),
  });
});

const layoutStore = useLayoutStore();
const firstInitialization = layoutStore.initialize();
const secondInitialization = layoutStore.initialize();

await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(
  [...initializationRequestUrlList].sort(),
  ['/settings/layout', '/settings/nav-bar-visibility', '/settings/sidebar'].sort(),
  'layout initialization must start each remote projection read exactly once',
);

deferredResponseByUrl.get('/settings/layout')?.resolve({
  id: 'remote-layout',
  type: 'pane',
  component: 'terminal',
  size: 100,
});
deferredResponseByUrl.get('/settings/sidebar')?.resolve({
  left: ['fileManager'],
  right: ['dockerManager'],
});
await Promise.resolve();

assert.equal(
  layoutStore.layoutTree,
  null,
  'layout projection must not commit while header visibility is pending',
);

deferredResponseByUrl.get('/settings/nav-bar-visibility')?.resolve({ visible: false });
await Promise.all([firstInitialization, secondInitialization]);

assert.equal(readLayoutId(layoutStore), 'remote-layout');
assert.deepEqual(layoutStore.sidebarPanes, {
  left: ['fileManager'],
  right: ['dockerManager'],
});
assert.equal(layoutStore.isHeaderVisible, false);
assert.equal(initializationRequestUrlList.length, 3);

storedValueByKey.set('fantetic_terminal_layout_config', JSON.stringify({
  id: 'cached-layout',
  type: 'pane',
  component: 'terminal',
  size: 100,
}));
storedValueByKey.set('fantetic_terminal_sidebar_config', JSON.stringify({
  left: ['quickCommands'],
  right: ['fileManager'],
}));
apiClient.defaults.adapter = async () => {
  throw new Error('layout service unavailable');
};

setActivePinia(createPinia());
const fallbackLayoutStore = useLayoutStore();
const reportedErrorList: unknown[][] = [];
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => reportedErrorList.push(args);
try {
  await fallbackLayoutStore.initialize();
} finally {
  console.error = originalConsoleError;
}

assert.equal(readLayoutId(fallbackLayoutStore), 'cached-layout');
assert.deepEqual(fallbackLayoutStore.sidebarPanes, {
  left: ['quickCommands'],
  right: ['fileManager'],
});
assert.equal(fallbackLayoutStore.isHeaderVisible, true);
assert.equal(
  reportedErrorList.filter(args => String(args[0]).startsWith('[Layout Store] Failed to load')).length,
  3,
  'each failed remote projection read must be reported by the layout runtime',
);

const mainSource = await readFile(
  new URL('../packages/frontend/src/main.ts', import.meta.url),
  'utf8',
);
assert.match(
  mainSource,
  /const layoutStore = useLayoutStore\(pinia\);/,
  'the composition root must own the authenticated layout store instance',
);
assert.match(
  mainSource,
  /layoutStore\.initialize\(\)/,
  'the composition root must explicitly await layout initialization',
);

console.log('layout runtime behavior passed');

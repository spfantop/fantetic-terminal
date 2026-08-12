import assert from 'node:assert/strict';
import {
  applyInitialLocaleSetting,
  createLocaleRuntime,
  createLocaleSettingCoordinator,
} from '../src/locale-runtime';

const loadedLocaleList: string[] = [];
const appliedLocaleList: string[] = [];
const documentLanguageList: string[] = [];

const runtime = createLocaleRuntime({
  availableLocales: ['en-US', 'ja-JP', 'zh-CN'],
  defaultLocale: 'en-US',
  loadMessages: async (locale) => {
    loadedLocaleList.push(locale);
    return { greeting: `hello:${locale}` };
  },
  applyMessages: () => undefined,
  applyLocale: (locale) => appliedLocaleList.push(locale),
  applyDocumentLanguage: (locale) => documentLanguageList.push(locale),
  readStoredLocale: () => 'ja-JP',
  readNavigatorLocale: () => 'zh-CN',
  persistLocale: () => undefined,
  reportError: () => undefined,
});

assert.equal(await runtime.initialize(), 'ja-JP');
assert.deepEqual(appliedLocaleList, ['ja-JP']);
assert.deepEqual(documentLanguageList, ['ja-JP']);
assert.deepEqual(loadedLocaleList, ['en-US', 'ja-JP']);

type Deferred = {
  promise: Promise<Record<string, unknown>>;
  resolve(messages: Record<string, unknown>): void;
  reject(error: unknown): void;
};

const deferredByLocale = new Map<string, Deferred>();
const createDeferred = (): Deferred => {
  let resolvePromise: Deferred['resolve'] = () => undefined;
  let rejectPromise: Deferred['reject'] = () => undefined;
  const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};
const concurrentAppliedLocaleList: string[] = [];
const concurrentLoadList: string[] = [];
const concurrentRuntime = createLocaleRuntime({
  availableLocales: ['en-US', 'ja-JP', 'zh-CN'],
  defaultLocale: 'en-US',
  loadMessages: (locale) => {
    concurrentLoadList.push(locale);
    const deferred = deferredByLocale.get(locale) ?? createDeferred();
    deferredByLocale.set(locale, deferred);
    return deferred.promise;
  },
  applyMessages: () => undefined,
  applyLocale: locale => concurrentAppliedLocaleList.push(locale),
  applyDocumentLanguage: () => undefined,
  readStoredLocale: () => null,
  readNavigatorLocale: () => 'en-US',
  persistLocale: () => undefined,
  reportError: () => undefined,
});

const staleSwitch = concurrentRuntime.setLocale('ja-JP');
const duplicateLatestSwitch = concurrentRuntime.setLocale('zh-CN');
const latestSwitch = concurrentRuntime.setLocale('zh-CN');
deferredByLocale.get('en-US')?.resolve({ greeting: 'hello' });
deferredByLocale.get('zh-CN')?.resolve({ greeting: '你好' });
assert.equal(await latestSwitch, 'zh-CN');
assert.equal(await duplicateLatestSwitch, 'zh-CN');
deferredByLocale.get('ja-JP')?.resolve({ greeting: 'こんにちは' });
assert.equal(await staleSwitch, 'zh-CN');
assert.deepEqual(concurrentLoadList, ['en-US', 'ja-JP', 'zh-CN']);
assert.deepEqual(concurrentAppliedLocaleList, ['zh-CN']);

const loadAttemptByLocale = new Map<string, number>();
const persistedLocaleList: string[] = [];
const retryAppliedLocaleList: string[] = [];
const retryRuntime = createLocaleRuntime({
  availableLocales: ['en-US', 'ja-JP'],
  defaultLocale: 'en-US',
  loadMessages: async (locale) => {
    const attemptCount = (loadAttemptByLocale.get(locale) ?? 0) + 1;
    loadAttemptByLocale.set(locale, attemptCount);
    if (locale === 'ja-JP' && attemptCount === 1) {
      throw new Error('locale chunk unavailable');
    }
    return { greeting: locale };
  },
  applyMessages: () => undefined,
  applyLocale: locale => retryAppliedLocaleList.push(locale),
  applyDocumentLanguage: () => undefined,
  readStoredLocale: () => null,
  readNavigatorLocale: () => 'en-US',
  persistLocale: locale => persistedLocaleList.push(locale),
  reportError: () => undefined,
});

await assert.rejects(retryRuntime.setLocale('ja-JP'), /locale chunk unavailable/);
assert.deepEqual(retryAppliedLocaleList, []);
assert.deepEqual(persistedLocaleList, []);
assert.equal(await retryRuntime.setLocale('ja-JP'), 'ja-JP');
assert.deepEqual(retryAppliedLocaleList, ['ja-JP']);
assert.deepEqual(persistedLocaleList, ['ja-JP']);
assert.equal(loadAttemptByLocale.get('en-US'), 1);
assert.equal(loadAttemptByLocale.get('ja-JP'), 2);

const staleFailureByLocale = new Map<string, Deferred>();
const staleFailureRuntime = createLocaleRuntime({
  availableLocales: ['en-US', 'ja-JP', 'zh-CN'],
  defaultLocale: 'en-US',
  loadMessages: (locale) => {
    if (locale === 'en-US') return Promise.resolve({ greeting: 'hello' });
    const deferred = createDeferred();
    staleFailureByLocale.set(locale, deferred);
    return deferred.promise;
  },
  applyMessages: () => undefined,
  applyLocale: () => undefined,
  applyDocumentLanguage: () => undefined,
  readStoredLocale: () => null,
  readNavigatorLocale: () => 'en-US',
  persistLocale: () => undefined,
  reportError: () => undefined,
});

const staleFailureSwitch = staleFailureRuntime.setLocale('ja-JP');
const recoveredSwitch = staleFailureRuntime.setLocale('zh-CN');
staleFailureByLocale.get('zh-CN')?.resolve({ greeting: '你好' });
assert.equal(await recoveredSwitch, 'zh-CN');
staleFailureByLocale.get('ja-JP')?.reject(new Error('stale chunk failed'));
assert.equal(await staleFailureSwitch, 'zh-CN');

const persistenceErrorList: unknown[] = [];
const storageFailureAppliedLocaleList: string[] = [];
const storageFailureRuntime = createLocaleRuntime({
  availableLocales: ['en-US'],
  defaultLocale: 'en-US',
  loadMessages: async () => ({ greeting: 'hello' }),
  applyMessages: () => undefined,
  applyLocale: locale => storageFailureAppliedLocaleList.push(locale),
  applyDocumentLanguage: () => undefined,
  readStoredLocale: () => null,
  readNavigatorLocale: () => 'en-US',
  persistLocale: () => {
    throw new Error('storage disabled');
  },
  reportError: error => persistenceErrorList.push(error),
});

assert.equal(await storageFailureRuntime.setLocale('en-US'), 'en-US');
assert.deepEqual(storageFailureAppliedLocaleList, ['en-US']);
assert.equal(persistenceErrorList.length, 1);
await assert.rejects(storageFailureRuntime.setLocale('fr-FR'), /Unsupported locale/);
assert.deepEqual(storageFailureAppliedLocaleList, ['en-US']);

const initializationErrorList: unknown[] = [];
const initializationFallbackList: string[] = [];
const initializationFallbackRuntime = createLocaleRuntime({
  availableLocales: ['en-US', 'ja-JP'],
  defaultLocale: 'en-US',
  loadMessages: async locale => {
    if (locale === 'ja-JP') throw new Error('selected locale unavailable');
    return { greeting: 'hello' };
  },
  applyMessages: () => undefined,
  applyLocale: locale => initializationFallbackList.push(locale),
  applyDocumentLanguage: () => undefined,
  readStoredLocale: () => 'ja-JP',
  readNavigatorLocale: () => 'en-US',
  persistLocale: () => undefined,
  reportError: error => initializationErrorList.push(error),
});

assert.equal(await initializationFallbackRuntime.initialize(), 'en-US');
assert.deepEqual(initializationFallbackList, ['en-US']);
assert.equal(initializationErrorList.length, 1);

const persistedChangeOrder: string[] = [];
let coordinatorActiveLocale = 'en-US';
const localeSettingCoordinator = createLocaleSettingCoordinator({
  readActiveLocale: () => coordinatorActiveLocale,
  activateLocale: async locale => {
    persistedChangeOrder.push(`activate:${locale}`);
    coordinatorActiveLocale = locale;
    return locale;
  },
});
await localeSettingCoordinator.change('ja-JP', async () => {
    persistedChangeOrder.push('persist');
});
assert.deepEqual(persistedChangeOrder, ['activate:ja-JP', 'persist']);

const rollbackOrder: string[] = [];
coordinatorActiveLocale = 'en-US';
const rollbackCoordinator = createLocaleSettingCoordinator({
  readActiveLocale: () => coordinatorActiveLocale,
  activateLocale: async locale => {
    rollbackOrder.push(`activate:${locale}`);
    coordinatorActiveLocale = locale;
    return locale;
  },
});
await assert.rejects(rollbackCoordinator.change('ja-JP', async () => {
    rollbackOrder.push('persist');
    throw new Error('settings save failed');
}), /settings save failed/);
assert.deepEqual(rollbackOrder, ['activate:ja-JP', 'persist', 'activate:en-US']);

const serializedOrder: string[] = [];
const firstPersistence = createDeferred();
const firstPersistenceStarted = createDeferred();
const serializedCoordinator = createLocaleSettingCoordinator({
  readActiveLocale: () => 'en-US',
  activateLocale: async locale => {
    serializedOrder.push(`activate:${locale}`);
    return locale;
  },
});
const firstChange = serializedCoordinator.change('ja-JP', async () => {
  serializedOrder.push('persist:ja-JP');
  firstPersistenceStarted.resolve({});
  await firstPersistence.promise;
});
const secondChange = serializedCoordinator.change('zh-CN', async () => {
  serializedOrder.push('persist:zh-CN');
});
await firstPersistenceStarted.promise;
assert.deepEqual(serializedOrder, ['activate:ja-JP', 'persist:ja-JP']);
firstPersistence.resolve({});
await Promise.all([firstChange, secondChange]);
assert.deepEqual(serializedOrder, [
  'activate:ja-JP',
  'persist:ja-JP',
  'activate:zh-CN',
  'persist:zh-CN',
]);

const initialProjectionList: string[] = [];
const initialProjectionErrorList: unknown[] = [];
assert.equal(await applyInitialLocaleSetting({
  targetLocale: 'ja-JP',
  fallbackLocale: 'en-US',
  activateLocale: async locale => {
    if (locale === 'ja-JP') throw new Error('selected chunk unavailable');
    return locale;
  },
  commitLocale: locale => initialProjectionList.push(locale),
  reportError: error => initialProjectionErrorList.push(error),
}), 'en-US');
assert.deepEqual(initialProjectionList, ['en-US']);
assert.equal(initialProjectionErrorList.length, 1);

const successfulProjectionList: string[] = [];
assert.equal(await applyInitialLocaleSetting({
  targetLocale: 'zh-CN',
  fallbackLocale: 'en-US',
  activateLocale: async locale => locale,
  commitLocale: locale => successfulProjectionList.push(locale),
  reportError: () => undefined,
}), 'zh-CN');
assert.deepEqual(successfulProjectionList, ['zh-CN']);

console.log('locale runtime behavior passed');

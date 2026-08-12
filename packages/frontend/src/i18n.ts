import { createI18n, type Composer } from 'vue-i18n';
import enUS from './locales/en-US.json';
import { createLocaleRuntime, type LocaleMessages } from './locale-runtime';

interface RecursiveStringRecord {
  [key: string]: string | RecursiveStringRecord;
}

type MessageSchema = RecursiveStringRecord;

export type AvailableLocale = 'en-US' | 'zh-CN' | 'ja-JP';
export const availableLocales: readonly AvailableLocale[] = ['en-US', 'zh-CN', 'ja-JP'];
export const defaultLng: AvailableLocale = 'en-US';

const localeLoaders: Record<AvailableLocale, () => Promise<LocaleMessages>> = {
  'en-US': async () => enUS,
  'zh-CN': async () => (await import('./locales/zh-CN.json')).default,
  'ja-JP': async () => (await import('./locales/ja-JP.json')).default,
};

const i18n = createI18n<[MessageSchema], string>({
  legacy: false,
  locale: defaultLng,
  fallbackLocale: defaultLng,
  messages: { [defaultLng]: enUS },
});

const globalComposer = i18n.global as unknown as Composer;
const localStorageKey = 'user-locale';

const localeRuntime = createLocaleRuntime({
  availableLocales,
  defaultLocale: defaultLng,
  loadMessages: locale => localeLoaders[locale as AvailableLocale](),
  applyMessages: (locale, messages) => {
    globalComposer.setLocaleMessage(locale, messages);
  },
  applyLocale: locale => {
    globalComposer.locale.value = locale;
  },
  applyDocumentLanguage: locale => {
    document.documentElement.lang = locale;
  },
  readStoredLocale: () => {
    try {
      return localStorage.getItem(localStorageKey);
    } catch (error) {
      console.error('[i18n] Failed to read locale from localStorage:', error);
      return null;
    }
  },
  readNavigatorLocale: () => navigator.language,
  persistLocale: locale => localStorage.setItem(localStorageKey, locale),
  reportError: error => console.error('[i18n] Failed to persist locale:', error),
});

export const initializeLocale = (): Promise<string> => localeRuntime.initialize();
export const setLocale = (locale: string): Promise<string> => localeRuntime.setLocale(locale);
export const readActiveLocale = (): string => globalComposer.locale.value;

export default i18n;

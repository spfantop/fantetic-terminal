export type LocaleMessages = Record<string, unknown>;

export interface LocaleRuntimeDependencies {
  availableLocales: readonly string[];
  defaultLocale: string;
  loadMessages(locale: string): Promise<LocaleMessages>;
  applyMessages(locale: string, messages: LocaleMessages): void;
  applyLocale(locale: string): void;
  applyDocumentLanguage(locale: string): void;
  readStoredLocale(): string | null;
  readNavigatorLocale(): string | undefined;
  persistLocale(locale: string): void;
  reportError(error: unknown): void;
}

export interface LocaleRuntime {
  initialize(): Promise<string>;
  setLocale(locale: string): Promise<string>;
}

export interface LocaleSettingCoordinator {
  change(locale: string, persistSetting: () => Promise<void>): Promise<string>;
}

export const applyInitialLocaleSetting = async ({
  targetLocale,
  fallbackLocale,
  activateLocale,
  commitLocale,
  reportError,
}: {
  targetLocale: string;
  fallbackLocale: string;
  activateLocale(locale: string): Promise<string>;
  commitLocale(locale: string): void;
  reportError(error: unknown): void;
}): Promise<string> => {
  let activeLocale: string;
  try {
    activeLocale = await activateLocale(targetLocale);
  } catch (error) {
    if (targetLocale === fallbackLocale) throw error;
    reportError(error);
    activeLocale = await activateLocale(fallbackLocale);
  }
  commitLocale(activeLocale);
  return activeLocale;
};

export const createLocaleSettingCoordinator = ({
  readActiveLocale,
  activateLocale,
}: {
  readActiveLocale(): string;
  activateLocale(locale: string): Promise<string>;
}): LocaleSettingCoordinator => {
  let queueTail = Promise.resolve();

  const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = queueTail.then(operation, operation);
    queueTail = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    change: (nextLocale, persistSetting) => enqueue(async () => {
      const previousLocale = readActiveLocale();
      const activeLocale = await activateLocale(nextLocale);
      try {
        await persistSetting();
        return activeLocale;
      } catch (error) {
        try {
          await activateLocale(previousLocale);
        } catch (rollbackError) {
          throw new Error('Failed to save and roll back locale setting.', {
            cause: { error, rollbackError },
          });
        }
        throw error;
      }
    }),
  };
};

export const normalizeLocale = (
  locale: string | null | undefined,
  availableLocales: readonly string[],
  defaultLocale: string,
): string => {
  if (!locale) return defaultLocale;
  if (availableLocales.includes(locale)) return locale;

  const language = locale.split('-')[0];
  return availableLocales.find(candidate => candidate.split('-')[0] === language)
    ?? defaultLocale;
};

export const createLocaleRuntime = (
  dependencies: LocaleRuntimeDependencies,
): LocaleRuntime => {
  const messageLoadByLocale = new Map<string, Promise<void>>();
  let latestRequestId = 0;
  let latestSwitchPromise = Promise.resolve(dependencies.defaultLocale);

  const resolveInitialLocale = (): string => {
    const storedLocale = dependencies.readStoredLocale();
    if (storedLocale && dependencies.availableLocales.includes(storedLocale)) {
      return storedLocale;
    }
    return normalizeLocale(
      dependencies.readNavigatorLocale(),
      dependencies.availableLocales,
      dependencies.defaultLocale,
    );
  };

  const loadLocale = (locale: string): Promise<void> => {
    const existingLoad = messageLoadByLocale.get(locale);
    if (existingLoad) return existingLoad;

    const load = dependencies.loadMessages(locale)
      .then(messages => {
        dependencies.applyMessages(locale, messages);
      })
      .catch(error => {
        messageLoadByLocale.delete(locale);
        throw error;
      });
    messageLoadByLocale.set(locale, load);
    return load;
  };

  const switchTo = async (
    locale: string,
    requestId: number,
    persist: boolean,
  ): Promise<string> => {
    try {
      await Promise.all([
        loadLocale(dependencies.defaultLocale),
        loadLocale(locale),
      ]);
    } catch (error) {
      if (requestId !== latestRequestId) return latestSwitchPromise;
      throw error;
    }
    if (requestId !== latestRequestId) return latestSwitchPromise;

    dependencies.applyLocale(locale);
    dependencies.applyDocumentLanguage(locale);
    if (persist) {
      try {
        dependencies.persistLocale(locale);
      } catch (error) {
        dependencies.reportError(error);
      }
    }
    return locale;
  };

  const apply = (locale: string, persist: boolean): Promise<string> => {
    const requestId = ++latestRequestId;
    latestSwitchPromise = switchTo(locale, requestId, persist);
    return latestSwitchPromise;
  };

  return {
    initialize: async () => {
      const initialLocale = resolveInitialLocale();
      try {
        return await apply(initialLocale, false);
      } catch (error) {
        if (initialLocale === dependencies.defaultLocale) throw error;
        dependencies.reportError(error);
        return apply(dependencies.defaultLocale, false);
      }
    },
    setLocale: locale => {
      if (!dependencies.availableLocales.includes(locale)) {
        return Promise.reject(new Error(`Unsupported locale '${locale}'.`));
      }
      return apply(locale, true);
    },
  };
};

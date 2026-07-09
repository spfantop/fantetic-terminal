import { darkUiTheme, defaultUiTheme } from '../features/appearance/config/default-themes';

export type UiThemeMode = 'default' | 'dark';

export type UiThemeSettingsLike = {
  uiThemeMode?: UiThemeMode | null;
  customUiTheme?: string | null;
  customDarkUiTheme?: string | null;
};

export type UiThemeModeUpdate = {
  uiThemeMode: UiThemeMode;
};

const safeParseUiTheme = (themeJson: string | null | undefined, fallback: Record<string, string>) => {
  if (!themeJson) return fallback;
  try {
    const parsedTheme = JSON.parse(themeJson);
    return parsedTheme && typeof parsedTheme === 'object' && !Array.isArray(parsedTheme)
      ? parsedTheme as Record<string, string>
      : fallback;
  } catch {
    return fallback;
  }
};

export const normalizeUiTheme = (uiTheme: Record<string, string> | null | undefined): Record<string, string> => ({
  ...defaultUiTheme,
  ...(uiTheme ?? {}),
});

const normalizedDarkUiTheme = normalizeUiTheme(darkUiTheme);

export const areUiThemesEqual = (
  uiTheme: Record<string, string>,
  targetTheme: Record<string, string>,
): boolean => {
  const keySet = new Set([
    ...Object.keys(normalizedDarkUiTheme),
    ...Object.keys(defaultUiTheme),
    ...Object.keys(uiTheme),
    ...Object.keys(targetTheme),
  ]);

  for (const key of keySet) {
    if (uiTheme[key] !== targetTheme[key]) {
      return false;
    }
  }

  return true;
};

export const isCanonicalDarkUiTheme = (uiTheme: Record<string, string> | null | undefined): boolean => (
  areUiThemesEqual(normalizeUiTheme(uiTheme), normalizedDarkUiTheme)
);

export const readUiThemeMode = (settings: UiThemeSettingsLike): UiThemeMode => (
  settings.uiThemeMode === 'dark' ? 'dark' : 'default'
);

export const resolveActiveUiTheme = (settings: UiThemeSettingsLike): Record<string, string> => {
  if (readUiThemeMode(settings) === 'dark') {
    return normalizeUiTheme(safeParseUiTheme(settings.customDarkUiTheme, darkUiTheme));
  }

  return normalizeUiTheme(safeParseUiTheme(settings.customUiTheme, defaultUiTheme));
};

export const createUiThemeModeUpdate = (uiThemeMode: UiThemeMode): UiThemeModeUpdate => ({
  uiThemeMode,
});

import { darkUiTheme, defaultUiTheme } from '../features/appearance/config/default-themes';

export type UiThemeMode = 'default' | 'dark';

export type UiThemeSettingsLike = {
  uiThemeMode?: UiThemeMode | null;
  customUiTheme?: string | null;
  customDarkUiTheme?: string | null;
  activeTerminalThemeId?: number | null;
  activeDefaultTerminalThemeId?: number | null;
  activeDarkTerminalThemeId?: number | null;
};

export type UiThemeModeUpdate = {
  uiThemeMode: UiThemeMode;
  activeTerminalThemeId?: number | null;
  activeDefaultTerminalThemeId?: number | null;
  activeDarkTerminalThemeId?: number | null;
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

const legacyDarkUiTheme = normalizeUiTheme({
  ...darkUiTheme,
  '--link-hover-color': '#fafafa',
  '--link-active-color': '#e5e5e5',
  '--link-active-bg-color': 'rgba(255, 255, 255, 0.08)',
  '--button-bg-color': '#f5f5f5',
  '--button-text-color': '#050505',
  '--button-hover-bg-color': '#d4d4d4',
});
const normalizedDarkUiTheme = normalizeUiTheme(darkUiTheme);

const areThemeRecordsEqual = (
  left: Record<string, string>,
  right: Record<string, string>,
): boolean => {
  const keySet = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keySet].every(key => left[key] === right[key]);
};

export const areUiThemesEqual = (
  uiTheme: Record<string, string>,
  targetTheme: Record<string, string>,
): boolean => areThemeRecordsEqual(uiTheme, targetTheme);

export const isCanonicalDarkUiTheme = (uiTheme: Record<string, string> | null | undefined): boolean => (
  areUiThemesEqual(normalizeUiTheme(uiTheme), normalizedDarkUiTheme)
);

export const readUiThemeMode = (settings: UiThemeSettingsLike): UiThemeMode => (
  settings.uiThemeMode === 'dark' ? 'dark' : 'default'
);

export const resolveActiveUiTheme = (settings: UiThemeSettingsLike): Record<string, string> => {
  if (readUiThemeMode(settings) === 'dark') {
    const resolvedDarkTheme = normalizeUiTheme(safeParseUiTheme(settings.customDarkUiTheme, darkUiTheme));
    return areThemeRecordsEqual(resolvedDarkTheme, legacyDarkUiTheme)
      ? normalizedDarkUiTheme
      : resolvedDarkTheme;
  }

  return normalizeUiTheme(safeParseUiTheme(settings.customUiTheme, defaultUiTheme));
};

const readModeTerminalThemeId = (
  settings: UiThemeSettingsLike,
  uiThemeMode: UiThemeMode,
): number | null | undefined => (
  uiThemeMode === 'dark'
    ? settings.activeDarkTerminalThemeId
    : settings.activeDefaultTerminalThemeId
);

export const resolveActiveTerminalThemeId = (
  settings: UiThemeSettingsLike,
  uiThemeMode = readUiThemeMode(settings),
): number | null | undefined => (
  readModeTerminalThemeId(settings, uiThemeMode)
);

export const createUiThemeModeUpdate = (
  uiThemeMode: UiThemeMode,
  settings?: UiThemeSettingsLike,
): UiThemeModeUpdate => {
  const update: UiThemeModeUpdate = { uiThemeMode };
  if (!settings) return update;

  const targetThemeId = resolveActiveTerminalThemeId(settings, uiThemeMode);
  if (targetThemeId === undefined) return update;

  update.activeTerminalThemeId = targetThemeId;
  if (uiThemeMode === 'dark') {
    update.activeDarkTerminalThemeId = targetThemeId;
  } else {
    update.activeDefaultTerminalThemeId = targetThemeId;
  }

  return update;
};

import type { ITheme } from '@xterm/xterm';

import { darkXtermTheme, lightXtermTheme } from '../features/appearance/config/default-themes';
import type { TerminalTheme } from '../types/terminal-theme.types';
import type { UiThemeMode } from './uiThemeState';

const BUILTIN_THEME_NAME: Record<UiThemeMode, string> = {
  default: 'Builtin Light',
  dark: 'Builtin Dark',
};

export const resolveTerminalTheme = (
  themeList: TerminalTheme[],
  activeThemeId: number | null | undefined,
  uiThemeMode: UiThemeMode,
): ITheme => {
  if (activeThemeId !== null && activeThemeId !== undefined) {
    const activeTheme = themeList.find(theme => Number(theme._id) === activeThemeId);
    if (activeTheme) return activeTheme.themeData;
  }
  return themeList.find(theme => theme.name === BUILTIN_THEME_NAME[uiThemeMode])?.themeData
    ?? (uiThemeMode === 'dark' ? darkXtermTheme : lightXtermTheme);
};

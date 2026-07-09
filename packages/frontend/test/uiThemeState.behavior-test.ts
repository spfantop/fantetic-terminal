import assert from 'node:assert/strict';
import {
  createUiThemeModeUpdate,
  resolveActiveUiTheme,
  isCanonicalDarkUiTheme,
  normalizeUiTheme,
} from '../src/utils/uiThemeState';
import { darkUiTheme, defaultUiTheme } from '../src/features/appearance/config/default-themes';

const darkLikeCustomTheme = {
  ...darkUiTheme,
  '--button-bg-color': defaultUiTheme['--button-bg-color'],
  '--button-text-color': defaultUiTheme['--button-text-color'],
};

assert.equal(
  isCanonicalDarkUiTheme(darkUiTheme),
  true,
  'the built-in dark theme should be recognized as the canonical dark theme',
);

assert.equal(
  isCanonicalDarkUiTheme(darkLikeCustomTheme),
  false,
  'a saved custom theme must not be treated as canonical dark only because core colors match',
);

assert.equal(
  normalizeUiTheme({})['--app-bg-color'],
  defaultUiTheme['--app-bg-color'],
  'normalization should preserve default UI theme fallbacks',
);

const customizedDefaultTheme = {
  ...defaultUiTheme,
  '--app-bg-color': '#123456',
};
const customizedDarkTheme = {
  ...darkUiTheme,
  '--app-bg-color': '#101010',
};

const toggleToDarkUpdate = createUiThemeModeUpdate('dark');
assert.deepEqual(
  toggleToDarkUpdate,
  { uiThemeMode: 'dark' },
  'the dock theme toggle should only switch modes and must not overwrite saved theme styles',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(toggleToDarkUpdate, 'customUiTheme'),
  false,
  'switching modes should not rewrite the saved default theme slot',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(toggleToDarkUpdate, 'customDarkUiTheme'),
  false,
  'switching modes should not rewrite the saved dark theme slot',
);

assert.equal(
  resolveActiveUiTheme({
    uiThemeMode: 'default',
    customUiTheme: JSON.stringify(customizedDefaultTheme),
    customDarkUiTheme: JSON.stringify(customizedDarkTheme),
  })['--app-bg-color'],
  '#123456',
  'default mode should use the saved default theme style',
);
assert.equal(
  resolveActiveUiTheme({
    uiThemeMode: 'dark',
    customUiTheme: JSON.stringify(customizedDefaultTheme),
    customDarkUiTheme: JSON.stringify(customizedDarkTheme),
  })['--app-bg-color'],
  '#101010',
  'dark mode should use the saved dark theme style',
);

const switchToDarkWithTerminalTheme = createUiThemeModeUpdate('dark', {
  activeDefaultTerminalThemeId: 12,
  activeDarkTerminalThemeId: 34,
});
assert.deepEqual(
  switchToDarkWithTerminalTheme,
  {
    uiThemeMode: 'dark',
    activeTerminalThemeId: 34,
    activeDarkTerminalThemeId: 34,
  },
  'switching to dark mode should select the saved dark terminal theme without changing terminal output state',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(switchToDarkWithTerminalTheme, 'terminalOutput'),
  false,
  'theme mode switching must not carry terminal output mutations',
);

const switchToDefaultWithTerminalTheme = createUiThemeModeUpdate('default', {
  activeDefaultTerminalThemeId: 12,
  activeDarkTerminalThemeId: 34,
});
assert.deepEqual(
  switchToDefaultWithTerminalTheme,
  {
    uiThemeMode: 'default',
    activeTerminalThemeId: 12,
    activeDefaultTerminalThemeId: 12,
  },
  'switching to default mode should select the saved default terminal theme',
);

assert.deepEqual(
  createUiThemeModeUpdate('dark', { activeTerminalThemeId: 12 }),
  { uiThemeMode: 'dark' },
  'mode switching should not infer mode terminal themes from the current activeTerminalThemeId alone',
);

console.log('ui theme state behavior ok');

import assert from 'node:assert/strict';
import {
  createUiThemeModeUpdate,
  resolveActiveUiTheme,
  isCanonicalDarkUiTheme,
  normalizeUiTheme,
} from '../src/utils/uiThemeState';
import { darkUiTheme, defaultUiTheme } from '../src/features/appearance/config/default-themes';

const legacyDarkUiTheme = {
  ...darkUiTheme,
  '--link-hover-color': '#fafafa',
  '--link-active-color': '#e5e5e5',
  '--link-active-bg-color': 'rgba(255, 255, 255, 0.08)',
  '--button-bg-color': '#f5f5f5',
  '--button-text-color': '#050505',
  '--button-hover-bg-color': '#d4d4d4',
};
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
assert.deepEqual(
  resolveActiveUiTheme({
    uiThemeMode: 'dark',
    customDarkUiTheme: JSON.stringify(legacyDarkUiTheme),
  }),
  normalizeUiTheme(darkUiTheme),
  'the previous built-in dark palette should migrate instead of remaining as a low-contrast custom theme',
);

const hexLuminance = (value: string): number => {
  const channelList = value.match(/[0-9a-f]{2}/gi)?.map(channel => Number.parseInt(channel, 16) / 255) ?? [];
  const [red, green, blue] = channelList.map(channel => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
};
const contrast = (left: string, right: string): number => {
  const [lighter, darker] = [hexLuminance(left), hexLuminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};
assert.ok(
  contrast(darkUiTheme['--link-active-color'], '#ffffff') >= 4.5,
  'dark primary buttons with white labels must meet WCAG AA contrast',
);
assert.ok(
  contrast(darkUiTheme['--button-bg-color'], darkUiTheme['--button-text-color']) >= 4.5,
  'dark semantic buttons must meet WCAG AA contrast',
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

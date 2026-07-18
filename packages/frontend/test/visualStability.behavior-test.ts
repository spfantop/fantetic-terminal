import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { darkXtermTheme, lightXtermTheme } from '../src/features/appearance/config/default-themes';
import { resolveTerminalTheme } from '../src/utils/terminalThemeFallback';

const light = { _id: '1', name: 'Builtin Light', themeData: { background: '#fff' }, isPreset: true };
const dark = { _id: '2', name: 'Builtin Dark', themeData: { background: '#000' }, isPreset: true };
assert.equal(resolveTerminalTheme([], null, 'default'), lightXtermTheme);
assert.equal(resolveTerminalTheme([], null, 'dark'), darkXtermTheme);
assert.equal(resolveTerminalTheme([light, dark], null, 'default'), light.themeData);
assert.equal(resolveTerminalTheme([light, dark], 999, 'dark'), dark.themeData, 'a deleted theme must fall back by UI mode');

const style = readFileSync(resolve('src/style.css'), 'utf8');
assert.match(style, /button:focus-visible[\s\S]*outline:\s*2px solid/);
assert.doesNotMatch(style, /button:focus-visible\s*\{[\s\S]{0,120}outline:\s*none\s*!important/);
assert.doesNotMatch(style, /input-focus-glow-rgb/);

const systemSettings = readFileSync(resolve('src/components/settings/SystemSettingsSection.vue'), 'utf8');
assert.match(systemSettings, /isSystemAdministrator && !isMobile/);
assert.match(systemSettings, /useDeviceDetection/);

const terminal = readFileSync(resolve('src/components/Terminal.vue'), 'utf8');
assert.doesNotMatch(terminal, /terminal-search-popover button\.is-active[\s\S]{0,240}primary-color/);
assert.match(terminal, /terminal-search-popover button:focus-visible/);

const layoutConfigurator = readFileSync(resolve('src/components/LayoutConfigurator.vue'), 'utf8');
const recordingSettings = readFileSync(resolve('src/components/settings/SessionRecordingSettings.vue'), 'utf8');
for (const source of [layoutConfigurator, recordingSettings]) {
  assert.match(source, /useDialogFocus/);
  assert.match(source, /aria-labelledby/);
}

console.log('visual stability behavior passed');

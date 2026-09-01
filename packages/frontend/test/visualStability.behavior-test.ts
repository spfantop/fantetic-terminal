import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { darkXtermTheme, lightXtermTheme } from '../src/features/appearance/config/default-themes';
import { resolveTerminalTheme } from '../src/utils/terminalThemeFallback';
import { calculateCenteredTerminalHorizontalPadding } from '../src/utils/terminalLayout';
import { resolveTerminalBackgroundReadability } from '../src/utils/terminalBackgroundReadability';

const light = { _id: '1', name: 'Builtin Light', themeData: { background: '#fff' }, isPreset: true };
const dark = { _id: '2', name: 'Builtin Dark', themeData: { background: '#000' }, isPreset: true };
assert.equal(resolveTerminalTheme([], null, 'default'), lightXtermTheme);
assert.equal(resolveTerminalTheme([], null, 'dark'), darkXtermTheme);
assert.equal(resolveTerminalTheme([light, dark], null, 'default'), light.themeData);
assert.equal(resolveTerminalTheme([light, dark], 999, 'dark'), dark.themeData, 'a deleted theme must fall back by UI mode');
assert.equal(
  calculateCenteredTerminalHorizontalPadding(1400, 0, 153, 9),
  11.5,
  'remaining terminal grid space should be evenly distributed between both edges',
);
assert.deepEqual(
  resolveTerminalBackgroundReadability({
    enabled: true,
    hasVisualBackground: true,
    configuredOverlayOpacity: 0,
    terminalThemeBackground: '#ffffff',
    hasUserTextEffect: false,
  }),
  { overlayOpacity: 0.45, highlightBackground: '#1e1e1e', useAutomaticTextShadow: true },
  'visual terminal backgrounds must receive non-persistent readability safeguards',
);
assert.deepEqual(
  resolveTerminalBackgroundReadability({
    enabled: true,
    hasVisualBackground: true,
    configuredOverlayOpacity: 0.7,
    terminalThemeBackground: '#ffffff',
    hasUserTextEffect: true,
  }),
  { overlayOpacity: 0.7, highlightBackground: '#1e1e1e', useAutomaticTextShadow: false },
  'stronger user overlay and explicit text effects must be preserved',
);
assert.deepEqual(
  resolveTerminalBackgroundReadability({
    enabled: false,
    hasVisualBackground: true,
    configuredOverlayOpacity: 0,
    terminalThemeBackground: '#ffffff',
    hasUserTextEffect: false,
  }),
  { overlayOpacity: 0, highlightBackground: '#ffffff', useAutomaticTextShadow: false },
  'disabled visual backgrounds must not alter terminal presentation',
);

const style = readFileSync(resolve('src/style.css'), 'utf8');
assert.match(style, /:root\s*\{[\s\S]*font-size:\s*14px/);
assert.match(style, /--ui-font-family:[\s\S]*Segoe UI/);
assert.match(style, /body\s*\{[\s\S]*font-family:\s*var\(--ui-font-family\)/);
assert.match(style, /body\s*\{[\s\S]*line-height:\s*1\.45/);
assert.match(style, /\.text-xl\s*\{[\s\S]*font-size:\s*1\.125rem/);
assert.match(style, /\.text-4xl\s*\{[\s\S]*font-size:\s*1\.75rem/);
assert.match(style, /button:focus-visible[\s\S]*outline:\s*2px solid/);
assert.doesNotMatch(style, /button:focus-visible\s*\{[\s\S]{0,120}outline:\s*none\s*!important/);
assert.doesNotMatch(style, /input-focus-glow-rgb/);
assert.match(
  style,
  /\.xterm\s*\{[^}]*box-sizing:\s*border-box/,
  'terminal padding must be included in the terminal width so both edges remain aligned',
);

const systemSettings = readFileSync(resolve('src/components/settings/SystemSettingsSection.vue'), 'utf8');
assert.match(systemSettings, /isSystemAdministrator && !isMobile/);
assert.match(systemSettings, /useDeviceDetection/);

const terminal = readFileSync(resolve('src/components/Terminal.vue'), 'utf8');
assert.match(
  terminal,
  /terminalElement\.clientWidth - viewport\.clientWidth/,
  'terminal fitting must use the rendered viewport width when determining scrollbar space',
);
assert.doesNotMatch(
  terminal,
  /core\?\.viewport\?\.scrollBarWidth/,
  'terminal fitting must not reserve a scrollbar that CSS has hidden',
);
assert.match(terminal, /synchronizeTerminalHorizontalPadding\(currentDimensions, cachedFitMetrics\)/);
assert.match(style, /--terminal-horizontal-padding/);
assert.doesNotMatch(terminal, /terminal-search-popover button\.is-active[\s\S]{0,240}primary-color/);
assert.match(terminal, /terminal-search-popover button:focus-visible/);
assert.doesNotMatch(terminal, /backdrop-filter:\s*blur/, 'live terminal overlays must not continuously blur changing content');
assert.match(terminal, /prefers-reduced-motion:\s*reduce/, 'terminal popovers must honor reduced-motion preferences');
assert.match(terminal, /has-auto-text-shadow/, 'visual backgrounds must provide an automatic text readability fallback');

const workspace = readFileSync(resolve('src/views/WorkspaceView.vue'), 'utf8');
assert.doesNotMatch(workspace, /transition:\s*height/, 'workspace resizing must not animate layout dimensions');

const connectionsView = readFileSync(resolve('src/views/ConnectionsView.vue'), 'utf8');
assert.match(connectionsView, /--server-control-size:\s*2\.1rem/);
assert.match(connectionsView, /\.server-icon-button\s*\{[\s\S]*width:\s*var\(--server-control-size\)[\s\S]*height:\s*var\(--server-control-size\)/);
assert.match(connectionsView, /\.server-icon-button i\s*\{[\s\S]*font-size:\s*0\.8rem/);
assert.doesNotMatch(connectionsView, /\.server-icon-button\s*\{[\s\S]{0,320}width:\s*2\.45rem/);
assert.match(connectionsView, /--server-list-primary-font-size:\s*1rem/);
assert.match(connectionsView, /--server-list-secondary-font-size:\s*0\.86rem/);
assert.match(connectionsView, /--server-list-badge-font-size:\s*0\.76rem/);
assert.match(connectionsView, /\.server-search-box input,[\s\S]*\.server-select\s*\{[\s\S]*font-size:\s*var\(--server-list-secondary-font-size\)/);
assert.match(connectionsView, /\.server-tag-filter-item\s*\{[\s\S]*font-size:\s*var\(--server-list-secondary-font-size\)/);
assert.match(connectionsView, /\.server-batch-toggle\s*\{[\s\S]*font-size:\s*var\(--server-list-secondary-font-size\)/);
assert.match(connectionsView, /\.server-batch-bar button\s*\{[\s\S]*font-size:\s*var\(--server-list-secondary-font-size\)/);
assert.match(connectionsView, /\.server-folder-header\s*\{[\s\S]*font-size:\s*var\(--server-list-primary-font-size\)/);
assert.match(connectionsView, /\.server-folder-count\s*\{[\s\S]*font-size:\s*var\(--server-list-badge-font-size\)/);
assert.match(connectionsView, /\.server-entry-name\s*\{[\s\S]*font-size:\s*var\(--server-list-primary-font-size\)/);
assert.match(connectionsView, /\.server-entry-meta\s*\{[\s\S]*font-size:\s*var\(--server-list-secondary-font-size\)/);
assert.match(connectionsView, /\.server-entry-type\s*\{[\s\S]*font-size:\s*var\(--server-list-badge-font-size\)/);
assert.match(connectionsView, /\.server-entry-tags span\s*\{[\s\S]*font-size:\s*var\(--server-list-badge-font-size\)/);
assert.match(connectionsView, /\.server-entry-detail-row\s*\{[\s\S]*font-size:\s*var\(--server-list-secondary-font-size\)/);
assert.match(connectionsView, /\.server-test-result\s*\{[\s\S]*font-size:\s*var\(--server-list-secondary-font-size\)/);
assert.match(connectionsView, /\.server-state\s*\{[\s\S]*font-size:\s*var\(--server-list-primary-font-size\)/);

const layoutRenderer = readFileSync(resolve('src/components/LayoutRenderer.vue'), 'utf8');
assert.match(layoutRenderer, /effectiveTerminalBackgroundOverlayOpacity/);
assert.match(
  layoutRenderer,
  /terminal-custom-html-layer[\s\S]{0,700}terminal-background-overlay-layer/,
  'the readability overlay must render above both image and custom HTML backgrounds',
);
assert.match(layoutRenderer, /overflow-hidden pt-8/);
assert.match(layoutRenderer, /items-center justify-center p-6/);
assert.match(layoutRenderer, /text-sm font-medium/);

const statusMonitor = readFileSync(resolve('src/components/StatusMonitor.vue'), 'utf8');
assert.match(statusMonitor, /\.status-state__icon\s*\{[\s\S]*font-size:\s*1\.25rem/);

const loginView = readFileSync(resolve('src/views/LoginView.vue'), 'utf8');
assert.match(loginView, /--app-bg-color:\s*#f8fafc/);
assert.match(loginView, /color-scheme:\s*light/);
assert.match(loginView, /<VueHcaptcha[\s\S]*theme="light"/);
assert.doesNotMatch(loginView, /<VueHcaptcha[\s\S]*theme="auto"/);
assert.match(loginView, /\.auth-field input\s*\{[\s\S]*height:\s*36px/);
assert.match(loginView, /\.auth-logo\s*\{[\s\S]*width:\s*44px[\s\S]*height:\s*44px/);
assert.match(loginView, /\.auth-brand h1\s*\{[\s\S]*font-size:\s*clamp\(1\.5rem, 2\.5vw, 2rem\)/);
assert.match(loginView, /\.auth-panel h2\s*\{[\s\S]*font-size:\s*clamp\(1\.2rem, 2vw, 1\.35rem\)/);

const setupView = readFileSync(resolve('src/views/SetupView.vue'), 'utf8');
assert.match(setupView, /\.auth-logo\s*\{[\s\S]*width:\s*44px[\s\S]*height:\s*44px/);
assert.match(setupView, /\.auth-field input\s*\{[\s\S]*height:\s*36px/);

const suspendedSessionsView = readFileSync(resolve('src/views/SuspendedSshSessionsView.vue'), 'utf8');
assert.doesNotMatch(suspendedSessionsView, /font-size:\s*2rem/);
assert.match(suspendedSessionsView, /font-semibold text-sm flex items-center/);

const layoutConfigurator = readFileSync(resolve('src/components/LayoutConfigurator.vue'), 'utf8');
const recordingSettings = readFileSync(resolve('src/components/settings/SessionRecordingSettings.vue'), 'utf8');
for (const source of [layoutConfigurator, recordingSettings]) {
  assert.match(source, /useDialogFocus/);
  assert.match(source, /aria-labelledby/);
}

console.log('visual stability behavior passed');

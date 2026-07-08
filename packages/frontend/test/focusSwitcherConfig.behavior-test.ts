import assert from 'node:assert/strict';
import {
  normalizeFocusSwitcherConfig,
  hasConfiguredFocusSwitcherTarget,
  normalizeFocusSwitcherShortcut,
  shouldSuppressFocusSwitcherKeyDefault,
  shouldSuppressPlainAltFocusSwitcherDefault,
  shouldEnableFocusSwitcherHotkeys,
} from '../src/utils/focusSwitcherConfig';

const legacyConfig = normalizeFocusSwitcherConfig([
  'quickCommandsSearch',
  'terminalSearch',
]);

assert.deepEqual(
  legacyConfig,
  {
    sequence: ['quickCommandsSearch', 'terminalSearch'],
    shortcuts: {},
  },
  'legacy array config should remain a valid focus switcher sequence',
);

const fullConfig = normalizeFocusSwitcherConfig({
  sequence: ['commandInput'],
  shortcuts: {
    terminalSearch: { shortcut: 'Alt+K' },
  },
});

assert.deepEqual(
  fullConfig,
  {
    sequence: ['commandInput'],
    shortcuts: {
      terminalSearch: { shortcut: 'Alt+K' },
    },
  },
  'full config should keep sequence and shortcut settings',
);

assert.equal(
  normalizeFocusSwitcherConfig({ sequence: ['commandInput'], shortcuts: null }),
  null,
  'invalid full config should be rejected',
);

assert.equal(
  hasConfiguredFocusSwitcherTarget({ sequence: ['terminalSearch'], shortcuts: {} }),
  true,
  'sequence entries should count as configured focus targets',
);

assert.equal(
  hasConfiguredFocusSwitcherTarget({ sequence: [], shortcuts: { terminalSearch: { shortcut: 'Alt+K' } } }),
  true,
  'shortcut entries should count as configured focus targets',
);

assert.equal(
  shouldSuppressPlainAltFocusSwitcherDefault(true, 'Alt'),
  true,
  'workspace plain Alt should always suppress the browser menu default',
);

assert.equal(
  shouldSuppressPlainAltFocusSwitcherDefault(false, 'Alt'),
  false,
  'plain Alt outside workspace should keep the browser default behavior',
);

assert.equal(
  shouldSuppressPlainAltFocusSwitcherDefault(true, 'K'),
  false,
  'non-Alt keys should not be suppressed by the plain Alt guard',
);

assert.equal(
  shouldSuppressFocusSwitcherKeyDefault(true, 'F', true),
  true,
  'Alt combinations should suppress browser menu defaults on focus switcher routes even before a shortcut match',
);

assert.equal(
  shouldSuppressFocusSwitcherKeyDefault(false, 'F', true),
  false,
  'Alt combinations outside focus switcher routes should keep browser defaults',
);

assert.equal(
  shouldSuppressFocusSwitcherKeyDefault(true, 'F', false),
  false,
  'non-Alt key events should not be suppressed',
);

assert.equal(
  normalizeFocusSwitcherShortcut('alt+k'),
  'Alt+K',
  'shortcuts should be normalized to a canonical Alt+Key form',
);

assert.equal(
  normalizeFocusSwitcherShortcut('Ctrl+K'),
  null,
  'non-Alt shortcuts should be rejected',
);

assert.equal(
  shouldEnableFocusSwitcherHotkeys('/'),
  true,
  'focus switcher hotkeys should be active on the home server route',
);

assert.equal(
  shouldEnableFocusSwitcherHotkeys('/connections'),
  true,
  'focus switcher hotkeys should be active on the connections workspace route',
);

assert.equal(
  shouldEnableFocusSwitcherHotkeys('/workspace'),
  true,
  'legacy workspace route should keep focus switcher hotkeys active',
);

assert.equal(
  shouldEnableFocusSwitcherHotkeys('/settings'),
  true,
  'settings overlay should keep focus switcher hotkeys active because it sits on top of the server route',
);

console.log('focus switcher config behavior ok');

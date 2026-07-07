import assert from 'node:assert/strict';
import {
  createDefaultFocusSwitcherConfig,
  normalizeFocusSwitcherShortcut,
  normalizeFocusSwitcherConfig,
} from '../settings/focusSwitcherConfig';

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
  'legacy focus switcher sequence array should be migrated to the full config shape',
);

assert.deepEqual(
  createDefaultFocusSwitcherConfig(),
  {
    sequence: [
      'quickCommandsSearch',
      'commandHistorySearch',
      'fileManagerSearch',
      'commandInput',
      'terminalSearch',
    ],
    shortcuts: {},
  },
  'default focus switcher setting should be stored in the full config shape',
);

assert.deepEqual(
  normalizeFocusSwitcherConfig({
    sequence: ['terminalSearch'],
    shortcuts: {
      terminalSearch: { shortcut: 'alt+k' },
    },
  }),
  {
    sequence: ['terminalSearch'],
    shortcuts: {
      terminalSearch: { shortcut: 'Alt+K' },
    },
  },
  'shortcut config should be normalized before backend persistence',
);

assert.equal(
  normalizeFocusSwitcherShortcut('Ctrl+K'),
  null,
  'backend shortcut normalization should reject non-Alt shortcuts',
);

assert.equal(
  normalizeFocusSwitcherConfig({ sequence: ['terminalSearch'], shortcuts: null }),
  null,
  'invalid focus switcher config should be rejected',
);

console.log('backend focus switcher config behavior ok');

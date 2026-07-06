import assert from 'node:assert/strict';
import {
  ACTION_LAYOUT_PANES,
  CONFIGURABLE_LAYOUT_PANES,
  normalizeConfigurablePaneList,
} from '../src/utils/layoutPanes';

assert.ok(
  CONFIGURABLE_LAYOUT_PANES.includes('terminalLineOutputToggle'),
  'terminal single/multi-line output toggle must be configurable in layout manager',
);

assert.ok(
  CONFIGURABLE_LAYOUT_PANES.includes('aiAssistant' as never),
  'AI assistant must be configurable in layout manager',
);

assert.ok(
  ACTION_LAYOUT_PANES.includes('terminalLineOutputToggle'),
  'terminal single/multi-line output toggle should behave as a toolbar action pane',
);

assert.equal(
  CONFIGURABLE_LAYOUT_PANES.includes('suspendedSshSessions' as never),
  false,
  'suspended session manager must not be configurable from layout manager',
);

assert.deepEqual(
  normalizeConfigurablePaneList([
    'fileManager',
    'suspendedSshSessions',
    'aiAssistant',
    'terminalLineOutputToggle',
    'fileManager',
    'unknown',
  ]),
  ['fileManager', 'aiAssistant', 'terminalLineOutputToggle'],
);

console.log('layoutPanes behavior ok');

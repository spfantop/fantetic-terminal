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
    'terminalLineOutputToggle',
    'fileManager',
    'unknown',
  ]),
  ['fileManager', 'terminalLineOutputToggle'],
);

console.log('layoutPanes behavior ok');

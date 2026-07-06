import assert from 'node:assert/strict';
import {
  ACTION_LAYOUT_PANES,
  CONFIGURABLE_LAYOUT_PANES,
  isConfigurableLayoutPane,
  normalizeConfigurablePaneList,
} from '../settings/layoutPanes';

assert.ok(
  CONFIGURABLE_LAYOUT_PANES.includes('terminalLineOutputToggle'),
  'terminal single/multi-line output toggle must be accepted by backend sidebar settings',
);

assert.ok(
  ACTION_LAYOUT_PANES.includes('terminalLineOutputToggle'),
  'terminal single/multi-line output toggle should be tracked as an action pane',
);

assert.equal(
  isConfigurableLayoutPane('suspendedSshSessions'),
  false,
  'suspended session manager must not be persisted as a configurable sidebar pane',
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

console.log('backend layout panes behavior ok');

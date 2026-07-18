import assert from 'node:assert/strict';
import {
  CONFIGURABLE_LAYOUT_PANES,
  normalizeLayoutTree,
} from '../src/utils/layoutPanes';

const legacyLayout = {
  id: 'root',
  type: 'container' as const,
  direction: 'vertical' as const,
  children: [
    { id: 'terminal', type: 'pane' as const, component: 'terminal', size: 94 },
    { id: 'command-bar', type: 'pane' as const, component: 'commandBar', size: 6 },
  ],
};

assert.deepEqual(normalizeLayoutTree(legacyLayout), {
  id: 'terminal',
  type: 'pane',
  component: 'terminal',
  size: 100,
});
assert.equal(CONFIGURABLE_LAYOUT_PANES.includes('commandBar'), false);

console.log('command bar removal behavior ok');

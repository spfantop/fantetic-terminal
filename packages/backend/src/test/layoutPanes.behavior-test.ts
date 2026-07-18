import assert from 'node:assert/strict';
import {
  ACTION_LAYOUT_PANES,
  CONFIGURABLE_LAYOUT_PANES,
  isConfigurableLayoutPane,
  normalizeConfigurablePaneList,
  normalizeLayoutTree,
} from '../settings/layoutPanes';
import {
  createDefaultLayoutTreeStructure,
  createDefaultSidebarPanesStructure,
} from '../settings/defaultLayoutConfig';

const listPaneComponents = (node: { type: string; component?: string; children?: unknown[] } | null): string[] => {
  if (!node) return [];
  if (node.type === 'pane' && node.component) return [node.component];
  return (node.children || []).flatMap((child) => listPaneComponents(child as any));
};

assert.ok(
  CONFIGURABLE_LAYOUT_PANES.includes('terminalLineOutputToggle'),
  'terminal single/multi-line output toggle must be accepted by backend sidebar settings',
);

assert.ok(
  ACTION_LAYOUT_PANES.includes('terminalLineOutputToggle'),
  'terminal single/multi-line output toggle should be tracked as an action pane',
);

assert.ok(
  CONFIGURABLE_LAYOUT_PANES.includes('aiAssistant' as never),
  'AI assistant must be accepted by backend sidebar settings so its saved position survives refresh',
);

assert.equal(
  isConfigurableLayoutPane('suspendedSshSessions'),
  false,
  'suspended session manager must not be persisted as a configurable sidebar pane',
);

assert.deepEqual(
  normalizeLayoutTree({
    id: 'root', type: 'container', direction: 'vertical', children: [
      { id: 'terminal', type: 'pane', component: 'terminal', size: 94 },
      { id: 'command-bar', type: 'pane', component: 'commandBar', size: 6 },
    ],
  }),
  { id: 'terminal', type: 'pane', component: 'terminal', size: 100 },
  'legacy command bar layouts should collapse into a full-size terminal pane',
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

assert.deepEqual(
  createDefaultSidebarPanesStructure().right,
  ['terminalLineOutputToggle', 'aiAssistant', 'fileManager', 'quickCommands', 'dockerManager'],
  'default right sidebar panes should match the requested layout manager order',
);

assert.equal(
  listPaneComponents(createDefaultLayoutTreeStructure()).includes('statusMonitor'),
  false,
  'default workspace layout should not include a status monitor container',
);

console.log('backend layout panes behavior ok');

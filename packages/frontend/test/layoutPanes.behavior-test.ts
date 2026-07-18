import assert from 'node:assert/strict';
import {
  ACTION_LAYOUT_PANES,
  CONFIGURABLE_LAYOUT_PANES,
  createLayoutEditorTree,
  normalizeConfigurablePaneList,
  normalizeLayoutTree,
} from '../src/utils/layoutPanes';
import {
  createDefaultLayout,
  DEFAULT_SIDEBAR_PANES,
} from '../src/utils/defaultLayoutConfig';

const listPaneComponents = (node: { type: string; component?: string; children?: unknown[] } | null): string[] => {
  if (!node) return [];
  if (node.type === 'pane' && node.component) return [node.component];
  return (node.children || []).flatMap((child) => listPaneComponents(child as any));
};

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
  normalizeLayoutTree({
    id: 'root', type: 'container', direction: 'vertical', children: [
      { id: 'terminal', type: 'pane', component: 'terminal', size: 94 },
      { id: 'command-bar', type: 'pane', component: 'commandBar', size: 6 },
    ],
  }),
  { id: 'terminal', type: 'pane', component: 'terminal', size: 100 },
  'legacy command bar layouts should be collapsed before rendering',
);

assert.deepEqual(
  createLayoutEditorTree({ id: 'terminal', type: 'pane', component: 'terminal', size: 100 }, () => 'editor-root'),
  {
    id: 'editor-root',
    type: 'container',
    direction: 'vertical',
    children: [{ id: 'terminal', type: 'pane', component: 'terminal', size: 100 }],
  },
  'a single-pane layout needs an editor-only root container so the preview can accept additional panes',
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
  DEFAULT_SIDEBAR_PANES.right,
  ['terminalLineOutputToggle', 'aiAssistant', 'fileManager', 'quickCommands', 'dockerManager'],
  'default right sidebar panes should match the requested layout manager order',
);

assert.equal(
  listPaneComponents(createDefaultLayout(() => 'test-id')).includes('statusMonitor'),
  false,
  'default workspace layout should not include a status monitor container',
);

console.log('layoutPanes behavior ok');

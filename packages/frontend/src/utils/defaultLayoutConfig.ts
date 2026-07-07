import type { LayoutNode } from '../stores/layout.store';
import type { SidebarPaneConfig } from './layoutPanes';

export const createDefaultLayout = (generateId: () => string): LayoutNode => ({
  id: generateId(),
  type: 'container',
  direction: 'vertical',
  children: [
    {
      id: generateId(),
      type: 'pane',
      component: 'terminal',
      size: 94.00342561521252,
    },
    {
      id: generateId(),
      type: 'pane',
      component: 'commandBar',
      size: 5.996574384787479,
    },
  ],
});

export const DEFAULT_SIDEBAR_PANES: SidebarPaneConfig = {
  left: [],
  right: ['terminalLineOutputToggle', 'aiAssistant', 'fileManager', 'quickCommands', 'dockerManager'],
};

export const cloneDefaultSidebarPanes = (): SidebarPaneConfig => ({
  left: [...DEFAULT_SIDEBAR_PANES.left],
  right: [...DEFAULT_SIDEBAR_PANES.right],
});

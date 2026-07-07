import type { LayoutNode, SidebarConfig } from '../types/settings.types';

type OmitIdRecursive<T> = T extends object
  ? { [K in keyof Omit<T, 'id'>]: OmitIdRecursive<T[K]> }
  : T;

export const createDefaultLayoutTreeStructure = (): OmitIdRecursive<LayoutNode> => ({
  type: 'container',
  direction: 'vertical',
  children: [
    { type: 'pane', component: 'terminal', size: 94.00342561521252 },
    { type: 'pane', component: 'commandBar', size: 5.996574384787479 },
  ],
});

export const createDefaultSidebarPanesStructure = (): SidebarConfig => ({
  left: [],
  right: ['terminalLineOutputToggle', 'aiAssistant', 'fileManager', 'quickCommands', 'dockerManager'],
});

import type { LayoutNode, SidebarConfig } from '../types/settings.types';

type OmitIdRecursive<T> = T extends object
  ? { [K in keyof Omit<T, 'id'>]: OmitIdRecursive<T[K]> }
  : T;

export const createDefaultLayoutTreeStructure = (): OmitIdRecursive<LayoutNode> => ({
  type: 'pane',
  component: 'terminal',
  size: 100,
});

export const createDefaultSidebarPanesStructure = (): SidebarConfig => ({
  left: [],
  right: ['terminalLineOutputToggle', 'aiAssistant', 'fileManager', 'quickCommands', 'dockerManager'],
});

export const CONFIGURABLE_LAYOUT_PANES = [
  'connections',
  'terminal',
  'fileManager',
  'editor',
  'statusMonitor',
  'commandHistory',
  'quickCommands',
  'aiAssistant',
  'dockerManager',
  'terminalLineOutputToggle',
  'transferProgress',
] as const;

export type ConfigurableLayoutPane = typeof CONFIGURABLE_LAYOUT_PANES[number];

export const ACTION_LAYOUT_PANES = [
  'terminalLineOutputToggle',
] as const;

export type ActionLayoutPane = typeof ACTION_LAYOUT_PANES[number];

export type SidebarPaneConfig = {
  left: ConfigurableLayoutPane[];
  right: ConfigurableLayoutPane[];
};

const configurablePaneSet = new Set<string>(CONFIGURABLE_LAYOUT_PANES);
const actionPaneSet = new Set<string>(ACTION_LAYOUT_PANES);

export const isConfigurableLayoutPane = (value: unknown): value is ConfigurableLayoutPane => (
  typeof value === 'string' && configurablePaneSet.has(value)
);

export const isActionLayoutPane = (value: unknown): value is ActionLayoutPane => (
  typeof value === 'string' && actionPaneSet.has(value)
);

export const normalizeConfigurablePaneList = (value: readonly unknown[]): ConfigurableLayoutPane[] => {
  const panes: ConfigurableLayoutPane[] = [];
  const seen = new Set<ConfigurableLayoutPane>();

  value.forEach((item) => {
    if (!isConfigurableLayoutPane(item) || seen.has(item)) return;
    panes.push(item);
    seen.add(item);
  });

  return panes;
};

type LayoutTreeNode = {
  id?: string;
  type?: 'pane' | 'container';
  component?: unknown;
  direction?: 'horizontal' | 'vertical';
  children?: LayoutTreeNode[];
  size?: number;
};

const normalizeChildSizes = (children: LayoutTreeNode[]): LayoutTreeNode[] => {
  const total = children.reduce((sum, child) => sum + (typeof child.size === 'number' && child.size > 0 ? child.size : 1), 0);
  return children.map(child => ({
    ...child,
    size: ((typeof child.size === 'number' && child.size > 0 ? child.size : 1) / total) * 100,
  }));
};

export const normalizeLayoutTree = (node: LayoutTreeNode | null | undefined): LayoutTreeNode | null => {
  if (!node || (node.type !== 'pane' && node.type !== 'container')) return null;

  if (node.type === 'pane') {
    return isConfigurableLayoutPane(node.component) ? { ...node, component: node.component } : null;
  }

  const children = (node.children ?? [])
    .map(child => normalizeLayoutTree(child))
    .filter((child): child is LayoutTreeNode => child !== null);

  if (children.length === 0) return null;
  if (children.length === 1) return { ...children[0], size: 100 };

  return {
    ...node,
    children: normalizeChildSizes(children),
  };
};

// 编辑器需要容器节点作为拖放目标；此包装仅存在于布局配置界面，保存时会再次归一化。
export const createLayoutEditorTree = (
  node: LayoutTreeNode | null | undefined,
  generateId: () => string,
): LayoutTreeNode => {
  const normalizedNode = normalizeLayoutTree(node);
  if (normalizedNode?.type === 'container') return normalizedNode;

  return {
    id: generateId(),
    type: 'container',
    direction: 'vertical',
    children: normalizedNode ? [{ ...normalizedNode, size: 100 }] : [],
  };
};


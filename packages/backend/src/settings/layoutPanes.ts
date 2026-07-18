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

const configurablePaneSet = new Set<string>(CONFIGURABLE_LAYOUT_PANES);

export const isConfigurableLayoutPane = (value: unknown): value is ConfigurableLayoutPane => (
  typeof value === 'string' && configurablePaneSet.has(value)
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
  id?: unknown;
  type?: unknown;
  component?: unknown;
  direction?: unknown;
  children?: unknown;
  size?: unknown;
};

const normalizeChildSizes = <T extends { size?: unknown }>(children: T[]): T[] => {
  if (children.length === 0) return children;
  const total = children.reduce((sum, child) => (
    sum + (Number.isFinite(Number(child.size)) && Number(child.size) > 0 ? Number(child.size) : 0)
  ), 0);
  const fallbackSize = 100 / children.length;
  return children.map((child) => ({
    ...child,
    size: total > 0
      ? Number((((Number.isFinite(Number(child.size)) && Number(child.size) > 0 ? Number(child.size) : fallbackSize) / total) * 100).toFixed(4))
      : Number(fallbackSize.toFixed(4)),
  }));
};

/** 移除已废弃面板并将旧布局折叠为可渲染的树。 */
export const normalizeLayoutTree = (value: unknown): LayoutTreeNode | null => {
  if (!value || typeof value !== 'object') return null;
  const node = value as LayoutTreeNode;
  const size = Number.isFinite(node.size) && Number(node.size) > 0 ? Number(node.size) : undefined;

  if (node.type === 'pane') {
    if (!isConfigurableLayoutPane(node.component)) return null;
    return {
      id: typeof node.id === 'string' ? node.id : undefined,
      type: 'pane',
      component: node.component,
      size,
    };
  }

  if (node.type !== 'container' || !Array.isArray(node.children)) return null;
  const children = node.children
    .map(normalizeLayoutTree)
    .filter((child): child is LayoutTreeNode => child !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return { ...children[0], size: 100 };
  return {
    id: typeof node.id === 'string' ? node.id : undefined,
    type: 'container',
    direction: node.direction === 'horizontal' ? 'horizontal' : 'vertical',
    size,
    children: normalizeChildSizes(children),
  };
};

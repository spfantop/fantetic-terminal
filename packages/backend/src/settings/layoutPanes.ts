export const CONFIGURABLE_LAYOUT_PANES = [
  'connections',
  'terminal',
  'commandBar',
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

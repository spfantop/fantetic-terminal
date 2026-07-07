export interface FocusItemConfig {
  shortcut?: string;
}

export interface FocusSwitcherFullConfig {
  sequence: string[];
  shortcuts: Record<string, FocusItemConfig>;
}

export const DEFAULT_FOCUS_SWITCHER_SEQUENCE = [
  'quickCommandsSearch',
  'commandHistorySearch',
  'fileManagerSearch',
  'commandInput',
  'terminalSearch',
];

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value) && value.every(item => typeof item === 'string')
);

const isFocusItemConfig = (value: unknown): value is FocusItemConfig => (
  typeof value === 'object'
  && value !== null
  && (
    !Object.prototype.hasOwnProperty.call(value, 'shortcut')
    || typeof (value as FocusItemConfig).shortcut === 'string'
  )
);

const isShortcutConfigMap = (value: unknown): value is Record<string, FocusItemConfig> => (
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
  && Object.values(value).every(isFocusItemConfig)
);

export const normalizeFocusSwitcherShortcut = (shortcut: unknown): string | null => {
  if (typeof shortcut !== 'string') return null;

  const match = shortcut.trim().match(/^Alt\+([a-z0-9])$/i);
  if (!match) return null;

  return `Alt+${match[1].toUpperCase()}`;
};

export const createEmptyFocusSwitcherConfig = (): FocusSwitcherFullConfig => ({
  sequence: [],
  shortcuts: {},
});

export const createDefaultFocusSwitcherConfig = (): FocusSwitcherFullConfig => ({
  sequence: [...DEFAULT_FOCUS_SWITCHER_SEQUENCE],
  shortcuts: {},
});

export const normalizeFocusSwitcherConfig = (value: unknown): FocusSwitcherFullConfig | null => {
  if (isStringArray(value)) {
    return {
      sequence: [...value],
      shortcuts: {},
    };
  }

  if (
    typeof value === 'object'
    && value !== null
    && isStringArray((value as FocusSwitcherFullConfig).sequence)
    && isShortcutConfigMap((value as FocusSwitcherFullConfig).shortcuts)
  ) {
    return {
      sequence: [...(value as FocusSwitcherFullConfig).sequence],
      shortcuts: Object.fromEntries(
        Object.entries((value as FocusSwitcherFullConfig).shortcuts)
          .map(([id, config]) => {
            const normalizedShortcut = normalizeFocusSwitcherShortcut(config.shortcut);
            return [
              id,
              normalizedShortcut ? { shortcut: normalizedShortcut } : {},
            ];
          }),
      ),
    };
  }

  return null;
};

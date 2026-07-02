export type ServerIconKey = string;

export interface ServerIconOption {
  key: ServerIconKey;
  labelKey: string;
  fallbackLabel: string;
  path: string;
  displayName: string;
}

const DEFAULT_SERVER_OUTLINE_PATH =
  'M13 19H14A1 1 0 0 0 15 18V16H19A2 2 0 0 0 21 14V6A2 2 0 0 0 19 4H5A2 2 0 0 0 3 6V14A2 2 0 0 0 5 16H9V18A1 1 0 0 0 10 19H11V20H8V22H16V20H13V19M5 6H19V14H5V6Z';

const toDisplayName = (name: string) =>
  name.replace(/^mdi/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();

const isMdiPath = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('M');

const createIconOption = (name: string, path: string): ServerIconOption => ({
  key: name,
  labelKey: `connections.icons.${name}`,
  fallbackLabel: toDisplayName(name),
  displayName: toDisplayName(name),
  path,
});

const popularIconNames = [
  'mdiServerOutline',
  'mdiMicrosoftWindows',
  'mdiLinux',
  'mdiDebian',
  'mdiUbuntu',
  'mdiFedora',
  'mdiApple',
  'mdiDocker',
  'mdiKubernetes',
  'mdiDatabase',
  'mdiCloud',
  'mdiRaspberryPi',
  'mdiConsole',
  'mdiMonitor',
  'mdiCube',
  'mdiFreebsd',
  'mdiServer',
  'mdiDesktopClassic',
  'mdiLaptop',
  'mdiNas',
  'mdiRouter',
  'mdiAccessPoint',
  'mdiWebhook',
  'mdiApi',
  'mdiCodeBraces',
  'mdiGit',
  'mdiGithub',
  'mdiGitlab',
  'mdiAws',
  'mdiMicrosoftAzure',
  'mdiGoogleCloud',
  'mdiDigitalOcean',
  'mdiNginx',
  'mdiRedhat',
  'mdiArchLinux',
  'mdiCentos',
  'mdiAlpineLinux',
  'mdiSuse',
  'mdiGentoo',
];

const legacyIconMap: Record<string, ServerIconKey> = {
  'fa-server': 'mdiServerOutline',
  'fa-terminal': 'mdiConsole',
  'fa-desktop': 'mdiDesktopClassic',
  'fa-plug': 'mdiConnection',
  'fa-database': 'mdiDatabase',
  'fa-cloud': 'mdiCloud',
  'fa-network-wired': 'mdiLanConnect',
  'fa-globe': 'mdiWeb',
  'fa-cube': 'mdiCube',
  'fa-microchip': 'mdiServer',
  'fa-shield-halved': 'mdiShieldCheckOutline',
  'fa-key': 'mdiKeyVariant',
  'fa-code-branch': 'mdiSourceBranch',
  'mdi-console': 'mdiConsole',
  'mdi-desktop-classic': 'mdiDesktopClassic',
  'mdi-monitor': 'mdiMonitor',
  'mdi-server': 'mdiServerOutline',
  'mdi-connection': 'mdiConnection',
  'mdi-tunnel': 'mdiTunnel',
  'mdi-script': 'mdiScriptTextOutline',
  'mdi-note-edit-outline': 'mdiNoteEditOutline',
};

let allIconOptionsPromise: Promise<ServerIconOption[]> | null = null;
let allIconOptionMapPromise: Promise<Map<string, ServerIconOption>> | null = null;
let popularIconOptionsPromise: Promise<ServerIconOption[]> | null = null;
let popularIconOptionMapPromise: Promise<Map<string, ServerIconOption>> | null = null;

const loadAllIconOptions = async () => {
  if (!allIconOptionsPromise) {
    allIconOptionsPromise = import('@mdi/js').then((mdi) => {
      const options: ServerIconOption[] = [];
      for (const [name, path] of Object.entries(mdi) as Array<[string, unknown]>) {
        if (name.startsWith('mdi') && isMdiPath(path)) {
          options.push(createIconOption(name, path));
        }
      }
      return options.sort((a, b) => a.displayName.localeCompare(b.displayName));
    });
  }
  return allIconOptionsPromise;
};

const loadAllIconOptionMap = async () => {
  if (!allIconOptionMapPromise) {
    allIconOptionMapPromise = loadAllIconOptions().then(
      (options) => new Map(options.map((option) => [option.key, option]))
    );
  }
  return allIconOptionMapPromise;
};

export const loadServerIconOptions = async () => {
  if (!popularIconOptionsPromise) {
    popularIconOptionsPromise = loadAllIconOptionMap().then((optionMap) =>
      popularIconNames
        .map((name) => optionMap.get(name))
        .filter((option): option is ServerIconOption => Boolean(option))
    );
  }
  return popularIconOptionsPromise;
};

const loadPopularIconOptionMap = async () => {
  if (!popularIconOptionMapPromise) {
    popularIconOptionMapPromise = loadServerIconOptions().then(
      (options) => new Map(options.map((option) => [option.key, option]))
    );
  }
  return popularIconOptionMapPromise;
};

export const serverIconOptions: ServerIconOption[] = [
  createIconOption('mdiServerOutline', DEFAULT_SERVER_OUTLINE_PATH),
];

export const getDefaultServerIconKey = (type?: 'SSH' | 'RDP' | 'VNC'): ServerIconKey => {
  if (type === 'RDP') return 'mdiMicrosoftWindows';
  if (type === 'VNC') return 'mdiMonitor';
  return 'mdiServerOutline';
};

export const normalizeServerIconKey = (
  icon?: string | null,
  type?: 'SSH' | 'RDP' | 'VNC',
): ServerIconKey => {
  if (icon && icon.startsWith('mdi')) return icon;
  if (icon && legacyIconMap[icon]) return legacyIconMap[icon];
  return getDefaultServerIconKey(type);
};

export const isDefaultServerIconForType = (
  icon: string | null | undefined,
  type?: 'SSH' | 'RDP' | 'VNC',
) => normalizeServerIconKey(icon, type) === getDefaultServerIconKey(type);

export const getServerIconOption = (
  icon?: string | null,
  type?: 'SSH' | 'RDP' | 'VNC',
) => createIconOption(normalizeServerIconKey(icon, type), DEFAULT_SERVER_OUTLINE_PATH);

export const getServerIconPath = (
  icon?: string | null,
  type?: 'SSH' | 'RDP' | 'VNC',
) => getServerIconOption(icon, type).path;

export const readServerIconOption = async (
  icon?: string | null,
  type?: 'SSH' | 'RDP' | 'VNC',
) => {
  const normalized = normalizeServerIconKey(icon, type);
  const popularIconOptionMap = await loadPopularIconOptionMap();
  const allIconOptionMap = await loadAllIconOptionMap();
  return (
    popularIconOptionMap.get(normalized) ??
    allIconOptionMap.get(normalized) ??
    createIconOption(getDefaultServerIconKey(type), DEFAULT_SERVER_OUTLINE_PATH)
  );
};

export const searchServerIconOptions = async (searchTerm: string, limit = 100) => {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return loadServerIconOptions();

  const allIconOptions = await loadAllIconOptions();
  return allIconOptions
    .filter((option) => option.displayName.includes(term) || option.key.toLowerCase().includes(term))
    .slice(0, limit);
};

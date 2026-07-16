import {
  mdiAccessPoint,
  mdiApi,
  mdiApple,
  mdiAws,
  mdiCentos,
  mdiCloud,
  mdiCodeBraces,
  mdiConnection,
  mdiConsole,
  mdiConsoleLine,
  mdiCube,
  mdiDatabase,
  mdiDebian,
  mdiDesktopClassic,
  mdiDigitalOcean,
  mdiDocker,
  mdiFedora,
  mdiFreebsd,
  mdiGentoo,
  mdiGit,
  mdiGithub,
  mdiGitlab,
  mdiGoogleCloud,
  mdiKeyVariant,
  mdiKubernetes,
  mdiLanConnect,
  mdiLaptop,
  mdiLinux,
  mdiMicrosoftAzure,
  mdiMicrosoftWindows,
  mdiMonitor,
  mdiNas,
  mdiNoteEditOutline,
  mdiRaspberryPi,
  mdiRedhat,
  mdiRouter,
  mdiScriptTextOutline,
  mdiServer,
  mdiServerOutline,
  mdiShieldCheckOutline,
  mdiSourceBranch,
  mdiTunnel,
  mdiUbuntu,
  mdiWeb,
  mdiWebhook,
} from '@mdi/js';

export type ServerIconKey = string;

export interface ServerIconOption {
  key: ServerIconKey;
  labelKey: string;
  fallbackLabel: string;
  path: string;
  displayName: string;
}

const DEFAULT_SERVER_OUTLINE_PATH = mdiServerOutline;

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
  'mdiRedhat',
  'mdiCentos',
  'mdiGentoo',
] as const;

const staticIconPaths: Record<string, string> = {
  mdiAccessPoint,
  mdiApi,
  mdiApple,
  mdiAws,
  mdiCentos,
  mdiCloud,
  mdiCodeBraces,
  mdiConnection,
  mdiConsole,
  mdiConsoleLine,
  mdiCube,
  mdiDatabase,
  mdiDebian,
  mdiDesktopClassic,
  mdiDigitalOcean,
  mdiDocker,
  mdiFedora,
  mdiFreebsd,
  mdiGentoo,
  mdiGit,
  mdiGithub,
  mdiGitlab,
  mdiGoogleCloud,
  mdiKeyVariant,
  mdiKubernetes,
  mdiLanConnect,
  mdiLaptop,
  mdiLinux,
  mdiMicrosoftAzure,
  mdiMicrosoftWindows,
  mdiMonitor,
  mdiNas,
  mdiNoteEditOutline,
  mdiRaspberryPi,
  mdiRedhat,
  mdiRouter,
  mdiScriptTextOutline,
  mdiServer,
  mdiServerOutline,
  mdiShieldCheckOutline,
  mdiSourceBranch,
  mdiTunnel,
  mdiUbuntu,
  mdiWeb,
  mdiWebhook,
};

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

const loadAllIconOptions = async () => {
  if (!allIconOptionsPromise) {
    // @ts-expect-error Vite resource query keeps the searchable namespace in a lazy chunk.
    allIconOptionsPromise = import('@mdi/js?server-icon-catalog').then((mdi) => {
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

export const serverIconOptions: ServerIconOption[] = popularIconNames.map(
  (name) => createIconOption(name, staticIconPaths[name])
);

const staticIconOptionMap = new Map(
  Object.entries(staticIconPaths).map(([name, iconPath]) => [name, createIconOption(name, iconPath)])
);

export const loadServerIconOptions = async () => {
  return serverIconOptions;
};

export const getDefaultServerIconKey = (type?: 'SSH' | 'RDP' | 'VNC' | 'TELNET'): ServerIconKey => {
  if (type === 'RDP') return 'mdiMicrosoftWindows';
  if (type === 'VNC') return 'mdiMonitor';
  if (type === 'TELNET') return 'mdiConsoleLine';
  return 'mdiServerOutline';
};

export const normalizeServerIconKey = (
  icon?: string | null,
  type?: 'SSH' | 'RDP' | 'VNC' | 'TELNET',
): ServerIconKey => {
  if (icon && icon.startsWith('mdi')) return icon;
  if (icon && legacyIconMap[icon]) return legacyIconMap[icon];
  return getDefaultServerIconKey(type);
};

export const isDefaultServerIconForType = (
  icon: string | null | undefined,
  type?: 'SSH' | 'RDP' | 'VNC' | 'TELNET',
) => normalizeServerIconKey(icon, type) === getDefaultServerIconKey(type);

export const getServerIconOption = (
  icon?: string | null,
  type?: 'SSH' | 'RDP' | 'VNC' | 'TELNET',
) => {
  const normalized = normalizeServerIconKey(icon, type);
  return staticIconOptionMap.get(normalized)
    ?? staticIconOptionMap.get(getDefaultServerIconKey(type))
    ?? createIconOption('mdiServerOutline', DEFAULT_SERVER_OUTLINE_PATH);
};

export const getServerIconPath = (
  icon?: string | null,
  type?: 'SSH' | 'RDP' | 'VNC' | 'TELNET',
) => getServerIconOption(icon, type).path;

export const readServerIconOption = async (
  icon?: string | null,
  type?: 'SSH' | 'RDP' | 'VNC' | 'TELNET',
) => {
  const normalized = normalizeServerIconKey(icon, type);
  const staticOption = staticIconOptionMap.get(normalized);
  if (staticOption) return staticOption;

  const allIconOptionMap = await loadAllIconOptionMap();
  return (
    allIconOptionMap.get(normalized) ??
    getServerIconOption(undefined, type)
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

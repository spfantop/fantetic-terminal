export type RuntimeConfigEnv = {
  isElectron: boolean;
  isProd: boolean;
  locationProtocol: string;
  locationHost: string;
};

export type RuntimeCapabilities = {
  runtime: 'web' | 'desktop';
  requiresAuthentication: boolean;
  remoteDesktop: boolean;
  multiUserAdministration: boolean;
};

export const ELECTRON_FRONTEND_PORT = 22457;
export const ELECTRON_BACKEND_PORT = 22458;

export const resolveIsElectronRuntime = (userAgent: string, hasElectronBridge: boolean): boolean => (
  userAgent.toLowerCase().includes('electron') || hasElectronBridge
);

export const readRuntimeConfigEnv = (): RuntimeConfigEnv => {
  const browserWindow = typeof window === 'undefined'
    ? undefined
    : window as Window & { electronAPI?: unknown };
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;

  return {
    isElectron: resolveIsElectronRuntime(
      userAgent,
      Boolean(browserWindow?.electronAPI),
    ),
    isProd: Boolean(import.meta.env?.PROD),
    locationProtocol: browserWindow?.location.protocol ?? 'http:',
    locationHost: browserWindow?.location.host ?? '',
  };
};

export const resolveApiBaseUrl = (env: RuntimeConfigEnv = readRuntimeConfigEnv()): string => {
  if (env.isElectron) {
    return `http://127.0.0.1:${ELECTRON_BACKEND_PORT}/api/v1`;
  }

  return '/api/v1';
};

export const resolveWebSocketBaseUrl = (env: RuntimeConfigEnv = readRuntimeConfigEnv()): string => {
  const protocol = env.locationProtocol === 'https:' ? 'wss:' : 'ws:';
  const host = env.isElectron
    ? `127.0.0.1:${ELECTRON_BACKEND_PORT}`
    : env.locationHost;

  return `${protocol}//${host}/ws/`;
};

export const isRemoteDesktopFeatureAvailable = (
  env: RuntimeConfigEnv = readRuntimeConfigEnv(),
): boolean => {
  return resolveRuntimeCapabilities(env).remoteDesktop;
};

export const isAccountFeatureAvailable = (
  env: RuntimeConfigEnv = readRuntimeConfigEnv(),
): boolean => {
  return resolveRuntimeCapabilities(env).requiresAuthentication;
};

export const resolveRuntimeCapabilities = (
  env: RuntimeConfigEnv = readRuntimeConfigEnv(),
): RuntimeCapabilities => env.isElectron
  ? {
      runtime: 'desktop',
      requiresAuthentication: false,
      remoteDesktop: false,
      multiUserAdministration: false,
    }
  : {
      runtime: 'web',
      requiresAuthentication: true,
      remoteDesktop: true,
      multiUserAdministration: true,
    };

export const resolveRemoteDesktopProxyWebSocketUrl = (
  token: string,
  width: number,
  height: number,
  env: RuntimeConfigEnv = readRuntimeConfigEnv(),
): string => {
  const params = new URLSearchParams({
    token,
    width: String(width),
    height: String(height),
    dpi: '96',
  });

  return `${resolveWebSocketBaseUrl(env)}rdp-proxy?${params.toString()}`;
};

export type RuntimeConfigEnv = {
  isElectron: boolean;
  isProd: boolean;
  locationProtocol: string;
  locationHost: string;
};

export const ELECTRON_FRONTEND_PORT = 22457;
export const ELECTRON_BACKEND_PORT = 22458;

export const readRuntimeConfigEnv = (): RuntimeConfigEnv => {
  const userAgent = navigator.userAgent.toLowerCase();
  const isElectronAppMode = import.meta.env.VITE_FANTETIC_APP_MODE === 'electron';

  return {
    isElectron:
      isElectronAppMode || userAgent.includes('electron') || Boolean((window as any).electronAPI),
    isProd: import.meta.env.PROD,
    locationProtocol: window.location.protocol,
    locationHost: window.location.host,
  };
};

export const resolveApiBaseUrl = (env: RuntimeConfigEnv = readRuntimeConfigEnv()): string => {
  if (env.isElectron && env.isProd) {
    return `http://localhost:${ELECTRON_BACKEND_PORT}/api/v1`;
  }

  return '/api/v1';
};

export const resolveWebSocketBaseUrl = (env: RuntimeConfigEnv = readRuntimeConfigEnv()): string => {
  const protocol = env.locationProtocol === 'https:' ? 'wss:' : 'ws:';
  const host = env.isElectron && env.isProd
    ? `localhost:${ELECTRON_BACKEND_PORT}`
    : env.locationHost;

  return `${protocol}//${host}/ws/`;
};

export const isRemoteDesktopFeatureAvailable = (
  env: RuntimeConfigEnv = readRuntimeConfigEnv(),
): boolean => {
  return !env.isElectron;
};

export const isAccountFeatureAvailable = (
  env: RuntimeConfigEnv = readRuntimeConfigEnv(),
): boolean => {
  return !env.isElectron;
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

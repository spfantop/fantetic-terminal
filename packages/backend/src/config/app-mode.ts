export const ELECTRON_APP_MODE = 'electron';
export const ELECTRON_APP_USER_ID = 1;
export const ELECTRON_APP_USERNAME = 'local-app';

export type RuntimeCapabilities = {
  runtime: 'web' | 'desktop';
  requiresAuthentication: boolean;
  remoteDesktop: boolean;
  multiUserAdministration: boolean;
};

export const isElectronAppMode = (): boolean => {
  return process.env.FANTETIC_APP_MODE === ELECTRON_APP_MODE;
};

export const resolveRuntimeCapabilities = (): RuntimeCapabilities => (
  isElectronAppMode()
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
      }
);

export const ELECTRON_APP_MODE = 'electron';
export const ELECTRON_APP_USER_ID = 1;
export const ELECTRON_APP_USERNAME = 'local-app';

export const isElectronAppMode = (): boolean => {
  return process.env.FANTETIC_APP_MODE === ELECTRON_APP_MODE;
};

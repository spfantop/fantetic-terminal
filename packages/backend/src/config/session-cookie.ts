import { ELECTRON_APP_MODE } from './app-mode';

export const resolveSessionCookieSecure = (appMode: string | undefined): false | 'auto' => (
  appMode === ELECTRON_APP_MODE ? false : 'auto'
);

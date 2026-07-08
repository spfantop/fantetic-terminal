import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveAppDataPath } from '../config/app-data-path';

assert.equal(
  resolveAppDataPath({
    providedBackendDataPath: 'D:\\AppData\\Fantetic\\backend-data',
    compiledConfigDir: path.join('D:\\', 'repo', 'packages', 'backend', 'dist', 'config'),
  }),
  'D:\\AppData\\Fantetic\\backend-data',
  'APP_BACKEND_DATA_PATH should win when Electron provides it',
);

assert.equal(
  resolveAppDataPath({
    compiledConfigDir: path.join('D:\\', 'repo', 'packages', 'backend', 'dist', 'config'),
  }),
  path.resolve('D:\\', 'repo', 'packages', 'backend', 'app-data-backend'),
  'Default app data path should live under packages/backend for local node runs',
);

console.log('appDataPath behavior tests passed');

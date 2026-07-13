const assert = require('node:assert/strict');
const path = require('node:path');

const {
  DEV_FRONTEND_PORT,
  DEV_BACKEND_PORT,
  createDevProcessSpecs,
  createSpawnConfig,
} = require('../dev-app');

const rootDir = path.resolve('D:/repo/fantetic-terminal');
const electronNonce = 'test-electron-runtime-nonce';
const specs = createDevProcessSpecs({ rootDir, npmCommand: 'npm.cmd', electronNonce });

assert.equal(DEV_FRONTEND_PORT, 22457);
assert.equal(DEV_BACKEND_PORT, 22458);
assert.deepEqual(
  specs.map((spec) => spec.name),
  ['backend', 'frontend', 'electron'],
);

assert.deepEqual(specs[0], {
  name: 'backend',
  command: 'npm.cmd',
  args: ['--workspace', '@fantetic-terminal/backend', 'run', 'dev'],
  cwd: rootDir,
  env: {
    FANTETIC_APP_MODE: 'electron',
    FANTETIC_ELECTRON_NONCE: electronNonce,
    HOST: '127.0.0.1',
    PORT: '22458',
  },
});

assert.deepEqual(specs[1], {
  name: 'frontend',
  command: 'npm.cmd',
  args: [
    '--workspace',
    '@fantetic-terminal/frontend',
    'run',
    'dev',
    '--',
    '--host',
    '127.0.0.1',
    '--port',
    '22457',
    '--strictPort',
  ],
  cwd: rootDir,
  env: {
    VITE_FANTETIC_APP_MODE: 'electron',
  },
});

assert.deepEqual(specs[2], {
  name: 'electron',
  command: 'npm.cmd',
  args: ['--prefix', 'electron-app', 'run', 'dev'],
  cwd: rootDir,
  env: {
    FANTETIC_ELECTRON_NONCE: electronNonce,
  },
});

const testEnv = { PATH: 'test-path' };
assert.deepEqual(createSpawnConfig(specs[0], {
  platform: 'win32',
  comSpec: 'cmd.exe',
  env: testEnv,
}), {
  command: 'cmd.exe',
  args: [
    '/d',
    '/s',
    '/c',
    'npm.cmd --workspace @fantetic-terminal/backend run dev',
  ],
  options: {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...testEnv,
      FANTETIC_APP_MODE: 'electron',
      FANTETIC_ELECTRON_NONCE: electronNonce,
      HOST: '127.0.0.1',
      PORT: '22458',
    },
  },
});

assert.deepEqual(createSpawnConfig(specs[0], {
  platform: 'linux',
  env: testEnv,
}), {
  command: 'npm.cmd',
  args: ['--workspace', '@fantetic-terminal/backend', 'run', 'dev'],
  options: {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...testEnv,
      FANTETIC_APP_MODE: 'electron',
      FANTETIC_ELECTRON_NONCE: electronNonce,
      HOST: '127.0.0.1',
      PORT: '22458',
    },
  },
});

console.log('dev-app process orchestration behavior passed');

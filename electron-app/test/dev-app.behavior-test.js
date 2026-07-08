const assert = require('node:assert/strict');
const path = require('node:path');

const {
  DEV_FRONTEND_PORT,
  createDevProcessSpecs,
  createSpawnConfig,
} = require('../dev-app');

const rootDir = path.resolve('D:/repo/fantetic-terminal');
const specs = createDevProcessSpecs({ rootDir, npmCommand: 'npm.cmd' });

assert.equal(DEV_FRONTEND_PORT, 22457);
assert.deepEqual(
  specs.map((spec) => spec.name),
  ['backend', 'frontend', 'electron'],
);

assert.deepEqual(specs[0], {
  name: 'backend',
  command: 'npm.cmd',
  args: ['--workspace', '@fantetic-terminal/backend', 'run', 'dev'],
  cwd: rootDir,
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
    '0.0.0.0',
    '--port',
    '22457',
    '--strictPort',
  ],
  cwd: rootDir,
});

assert.deepEqual(specs[2], {
  name: 'electron',
  command: 'npm.cmd',
  args: ['--prefix', 'electron-app', 'run', 'dev'],
  cwd: rootDir,
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
    env: testEnv,
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
    env: testEnv,
  },
});

console.log('dev-app process orchestration behavior passed');

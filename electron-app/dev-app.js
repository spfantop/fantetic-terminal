const { spawn } = require('node:child_process');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createElectronBackendReadinessProbe, waitForHttp } = require('./service-readiness');

const DEV_FRONTEND_PORT = 22457;
const DEV_BACKEND_PORT = 22458;

const getNpmCommand = () => (process.platform === 'win32' ? 'npm.cmd' : 'npm');

const quoteCmdArgument = (value) => {
  const stringValue = String(value);
  if (!/[()\[\]{}^=;!'+,`~&|<> \t"]/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replace(/(["^&|<>])/g, '^$1')}"`;
};

const createWindowsCommandLine = (command, args) => (
  [command, ...args].map(quoteCmdArgument).join(' ')
);

const createSpawnConfig = (spec, {
  platform = process.platform,
  comSpec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
  env = process.env,
} = {}) => {
  const options = {
    cwd: spec.cwd,
    stdio: 'inherit',
    env: {
      ...env,
      ...(spec.env ?? {}),
    },
  };

  if (platform === 'win32') {
    return {
      command: comSpec,
      args: ['/d', '/s', '/c', createWindowsCommandLine(spec.command, spec.args)],
      options,
    };
  }

  return {
    command: spec.command,
    args: spec.args,
    options,
  };
};

const createDevProcessSpecs = ({
  rootDir = path.resolve(__dirname, '..'),
  npmCommand = getNpmCommand(),
  electronNonce = randomBytes(32).toString('hex'),
} = {}) => [
  {
    name: 'backend',
    command: npmCommand,
    args: ['--workspace', '@fantetic-terminal/backend', 'run', 'dev'],
    cwd: rootDir,
    env: {
      FANTETIC_APP_MODE: 'electron',
      FANTETIC_ELECTRON_NONCE: electronNonce,
      HOST: '127.0.0.1',
      PORT: String(DEV_BACKEND_PORT),
    },
  },
  {
    name: 'frontend',
    command: npmCommand,
    args: [
      '--workspace',
      '@fantetic-terminal/frontend',
      'run',
      'dev',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      String(DEV_FRONTEND_PORT),
      '--strictPort',
    ],
    cwd: rootDir,
    env: {
      VITE_FANTETIC_APP_MODE: 'electron',
      FANTETIC_DEV_BACKEND_URL: `http://127.0.0.1:${DEV_BACKEND_PORT}`,
    },
  },
  {
    name: 'electron',
    command: npmCommand,
    args: ['--prefix', 'electron-app', 'run', 'dev'],
    cwd: rootDir,
    env: {
      FANTETIC_ELECTRON_NONCE: electronNonce,
    },
  },
];

const startManagedProcess = (spec) => {
  console.log(`[dev:app] starting ${spec.name}: ${spec.command} ${spec.args.join(' ')}`);
  const spawnConfig = createSpawnConfig(spec);

  return spawn(spawnConfig.command, spawnConfig.args, spawnConfig.options);
};

const stopProcess = (child) => {
  if (!child || child.exitCode !== null || child.killed) return;

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
    return;
  }

  child.kill('SIGTERM');
};

const run = async () => {
  const specs = createDevProcessSpecs();
  const runningProcesses = [];
  let shuttingDown = false;

  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;

    [...runningProcesses].reverse().forEach((child) => {
      stopProcess(child);
    });

    process.exit(code);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  const start = (spec) => {
    const child = startManagedProcess(spec);
    runningProcesses.push(child);

    child.on('exit', (code, signal) => {
      if (shuttingDown) return;

      if (spec.name === 'electron') {
        shutdown(code ?? (signal ? 0 : 1));
        return;
      }

      console.error(`[dev:app] ${spec.name} exited before dev app finished.`);
      shutdown(code ?? 1);
    });

    child.on('error', (error) => {
      if (shuttingDown) return;

      console.error(`[dev:app] failed to start ${spec.name}: ${error.message}`);
      shutdown(1);
    });

    return child;
  };

  try {
    const backendChild = start(specs[0]);
    const frontendChild = start(specs[1]);
    const electronNonce = specs[0].env.FANTETIC_ELECTRON_NONCE;

    await waitForHttp(`http://localhost:${DEV_BACKEND_PORT}/api/v1/status`, {
      label: 'backend',
      ...createElectronBackendReadinessProbe(electronNonce),
      isTargetAlive: () => backendChild.exitCode === null && !backendChild.killed,
    });
    await waitForHttp(`http://localhost:${DEV_FRONTEND_PORT}/`, {
      label: 'frontend',
      isTargetAlive: () => frontendChild.exitCode === null && !frontendChild.killed,
    });

    start(specs[2]);
  } catch (error) {
    console.error(`[dev:app] ${error instanceof Error ? error.message : String(error)}`);
    shutdown(1);
  }
};

module.exports = {
  DEV_FRONTEND_PORT,
  DEV_BACKEND_PORT,
  createDevProcessSpecs,
  createSpawnConfig,
  getNpmCommand,
  waitForHttp,
};

if (require.main === module) {
  run();
}

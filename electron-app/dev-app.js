const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const DEV_FRONTEND_PORT = 22457;
const DEV_BACKEND_PORT = 3001;

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
    env,
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
} = {}) => [
  {
    name: 'backend',
    command: npmCommand,
    args: ['--workspace', '@fantetic-terminal/backend', 'run', 'dev'],
    cwd: rootDir,
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
      '0.0.0.0',
      '--port',
      String(DEV_FRONTEND_PORT),
      '--strictPort',
    ],
    cwd: rootDir,
  },
  {
    name: 'electron',
    command: npmCommand,
    args: ['--prefix', 'electron-app', 'run', 'dev'],
    cwd: rootDir,
  },
];

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const requestHttp = (url) => new Promise((resolve, reject) => {
  const request = http.get(url, { timeout: 2000 }, (response) => {
    response.resume();
    response.on('end', () => {
      if (response.statusCode && response.statusCode < 500) {
        resolve();
        return;
      }

      reject(new Error(`HTTP ${response.statusCode}`));
    });
  });

  request.on('timeout', () => {
    request.destroy(new Error(`Timed out waiting for ${url}`));
  });
  request.on('error', reject);
});

const waitForHttp = async (url, {
  label = url,
  timeoutMs = 60000,
  intervalMs = 500,
} = {}) => {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await requestHttp(url);
      return;
    } catch (error) {
      lastError = error;
      await wait(intervalMs);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : 'timeout';
  throw new Error(`${label} was not ready at ${url}: ${reason}`);
};

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
    start(specs[0]);
    start(specs[1]);

    await waitForHttp(`http://localhost:${DEV_BACKEND_PORT}/api/v1/status`, {
      label: 'backend',
    });
    await waitForHttp(`http://localhost:${DEV_FRONTEND_PORT}/`, {
      label: 'frontend',
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

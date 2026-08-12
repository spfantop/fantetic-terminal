const { spawn } = require('node:child_process');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const rootDirectory = join(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const DEFAULT_MAXIMUM_CONCURRENCY = 4;

class WorkspaceTestSuiteError extends Error {
  constructor(resultList) {
    const failureCount = resultList.reduce((count, result) => count + result.failureList.length, 0);
    super(`${failureCount} workspace test group(s) failed.`);
    this.name = 'WorkspaceTestSuiteError';
    this.resultList = resultList;
  }
}

const collectTestScripts = (manifest) => Object.keys(manifest.scripts ?? {})
  .filter(name => name.startsWith('test:'))
  .sort((left, right) => left.localeCompare(right));

const readManifest = (directory) => JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));

const collectTestGroups = () => {
  const packageDirectory = join(rootDirectory, 'packages');
  const workspaceDirectoryList = readdirSync(packageDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(packageDirectory, entry.name, 'package.json')))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(entry => join(packageDirectory, entry.name));
  const groupList = [];

  for (const workspaceDirectory of workspaceDirectoryList) {
    const manifest = readManifest(workspaceDirectory);
    for (const scriptName of collectTestScripts(manifest)) {
      groupList.push({
        id: `${manifest.name}:${scriptName}`,
        label: `${manifest.name} ${scriptName}`,
        commandList: [['run', scriptName, `--workspace=${manifest.name}`]],
      });
    }
  }

  groupList.push({
    id: 'electron:test:behavior',
    label: 'electron-app test:behavior',
    commandList: [['run', 'test:behavior', '--prefix', 'electron-app']],
  });
  groupList.push({
    id: 'root:test:delivery',
    label: 'root test:delivery',
    commandList: [['run', 'test:delivery']],
  });

  return groupList.map((group, index) => ({ ...group, index }));
};

const runCommand = (argumentsList) => new Promise((resolvePromise) => {
  const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : npmCommand;
  const executableArguments = process.platform === 'win32'
    ? ['/d', '/s', '/c', `${npmCommand} ${argumentsList.join(' ')}`]
    : argumentsList;
  const child = spawn(executable, executableArguments, {
    cwd: rootDirectory,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const outputChunkList = [];
  let settled = false;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    resolvePromise(result);
  };
  child.stdout.on('data', chunk => outputChunkList.push(chunk));
  child.stderr.on('data', chunk => outputChunkList.push(chunk));
  child.on('error', (error) => finish({
    command: argumentsList,
    exitCode: 1,
    output: `${error.stack ?? error.message}\n`,
  }));
  child.on('close', (exitCode) => finish({
    command: argumentsList,
    exitCode: exitCode ?? 1,
    output: Buffer.concat(outputChunkList).toString('utf8'),
  }));
});

const executeGroup = async (group) => {
  const startedAt = Date.now();
  const outputList = [];
  const failureList = [];
  for (const command of group.commandList) {
    const commandResult = await runCommand(command);
    outputList.push(commandResult.output);
    if (commandResult.exitCode !== 0) failureList.push(commandResult);
  }
  return {
    group,
    durationMs: Date.now() - startedAt,
    output: outputList.join(''),
    failureList,
  };
};

const readMaximumConcurrency = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAXIMUM_CONCURRENCY;
};

const runWithConcurrency = async (groupList, maximumConcurrency, executeGroupAdapter) => {
  const resultList = new Array(groupList.length);
  let nextGroupIndex = 0;
  const worker = async () => {
    while (nextGroupIndex < groupList.length) {
      const currentIndex = nextGroupIndex;
      nextGroupIndex += 1;
      resultList[currentIndex] = await executeGroupAdapter(groupList[currentIndex]);
    }
  };
  const workerCount = Math.min(maximumConcurrency, groupList.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return resultList;
};

const runWorkspaceTests = async (options = {}) => {
  const groupList = collectTestGroups();
  const maximumConcurrency = readMaximumConcurrency(
    options.maximumConcurrency ?? process.env.WORKSPACE_TEST_CONCURRENCY,
  );
  const executeGroupAdapter = options.executeGroup ?? executeGroup;
  const writeOutput = options.writeOutput ?? (output => process.stdout.write(output));
  writeOutput(`Running ${groupList.length} test groups with concurrency ${maximumConcurrency}.\n`);

  const resultList = await runWithConcurrency(groupList, maximumConcurrency, executeGroupAdapter);
  for (const result of resultList) {
    const status = result.failureList.length === 0 ? 'PASS' : 'FAIL';
    writeOutput(`[${status}] ${result.group.label} (${result.durationMs} ms)\n`);
    if (result.failureList.length > 0 && result.output) writeOutput(result.output);
  }

  if (resultList.some(result => result.failureList.length > 0)) {
    throw new WorkspaceTestSuiteError(resultList);
  }
  return resultList;
};

if (require.main === module) {
  runWorkspaceTests().catch((error) => {
    console.error(error instanceof WorkspaceTestSuiteError ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  WorkspaceTestSuiteError,
  collectTestGroups,
  collectTestScripts,
  runWorkspaceTests,
};

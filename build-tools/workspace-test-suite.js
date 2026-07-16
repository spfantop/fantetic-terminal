const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const rootDirectory = join(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const collectTestScripts = (manifest) => Object.keys(manifest.scripts ?? {})
  .filter(name => name.startsWith('test:'))
  .sort((left, right) => left.localeCompare(right));

const readManifest = (directory) => JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));

const run = (argumentsList) => {
  const options = { cwd: rootDirectory, stdio: 'inherit' };
  if (process.platform === 'win32') {
    return execFileSync(process.env.ComSpec ?? 'cmd.exe', [
      '/d',
      '/s',
      '/c',
      `${npmCommand} ${argumentsList.join(' ')}`,
    ], options);
  }
  return execFileSync(npmCommand, argumentsList, options);
};

const runWorkspaceTests = () => {
  const packageDirectory = join(rootDirectory, 'packages');
  const workspaceDirectoryList = readdirSync(packageDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(packageDirectory, entry.name, 'package.json')))
    .map(entry => join(packageDirectory, entry.name));

  for (const workspaceDirectory of workspaceDirectoryList) {
    const manifest = readManifest(workspaceDirectory);
    for (const scriptName of collectTestScripts(manifest)) {
      run(['run', scriptName, `--workspace=${manifest.name}`]);
    }
  }

  run(['run', 'test:behavior', '--prefix', 'electron-app']);
  run(['run', 'test:delivery']);
};

if (require.main === module) runWorkspaceTests();

module.exports = { collectTestScripts, runWorkspaceTests };

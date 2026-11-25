const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const applyNodePtyPatch = (rootDir) => {
  // Workspace hoisting differs between development and production installs.
  for (const directory of ['node_modules/node-pty', 'packages/backend/node_modules/node-pty']) {
    const moduleDir = path.join(rootDir, directory);
    if (!fs.existsSync(moduleDir)) continue;
    const version = JSON.parse(fs.readFileSync(path.join(moduleDir, 'package.json'), 'utf8')).version;
    if (version !== '1.1.0') throw new Error(`node-pty patch incompatible version: ${version}`);
    const filename = path.join(moduleDir, 'lib/windowsPtyAgent.js');
    const source = fs.readFileSync(filename, 'utf8');
    const original = 'consoleProcessList.forEach(function (pid) {';
    const replacement = '(Array.isArray(consoleProcessList) ? consoleProcessList : []).forEach(function (pid) {';
    if (source.includes(replacement)) continue;
    if (source.split(original).length !== 2) throw new Error('node-pty patch incompatible windowsPtyAgent');
    // The native helper can report no list when its console has already exited.
    // Still release the PTY and worker, without dereferencing an absent list.
    fs.writeFileSync(filename, source.replace(original, replacement), 'utf8');
  }
};

const applyGuacamolePatch = (rootDir) => {
  const gatewayDir = path.join(rootDir, 'packages', 'remote-gateway');
  const guacamoleLiteDir = path.join(gatewayDir, 'node_modules', 'guacamole-lite');
  if (!fs.existsSync(guacamoleLiteDir)) return;
  const patch = fs.readFileSync(path.join(gatewayDir, 'patches', 'guacamole-lite+1.2.0.patch'), 'utf8').replace(/\r\n/g, '\n');
  const apply = (args) => {
    const result = spawnSync('git', ['apply', '--recount', ...args, '-'], {
      cwd: gatewayDir,
      input: patch,
      encoding: 'utf8',
      // Treat dependency files as ordinary files even inside a Git checkout. This
      // prevents Git from silently skipping paths outside its current prefix.
      env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(gatewayDir) },
    });
    if (result.error) throw result.error;
    return result;
  };
  if (apply(['--reverse', '--check']).status === 0) return;
  const check = apply(['--check']);
  if (check.status !== 0) throw new Error(`Cannot apply guacamole-lite security patch: ${check.stderr}`);
  const result = apply([]);
  if (result.status !== 0) throw new Error(`Cannot apply guacamole-lite security patch: ${result.stderr}`);
};

if (require.main === module) {
  // This JavaScript-only patch is required in production installs too.
  applyNodePtyPatch(path.resolve(__dirname, '..'));
  // Production Docker stages copy the verified patched module from the builder;
  // they must not require Git (or any development patch tooling) at runtime.
  const omitted = (process.env.npm_config_omit ?? '').split(/[\s,]+/);
  // npm may omit npm_config_omit when production already makes dev omission the default.
  if (process.env.NODE_ENV !== 'production' && !omitted.includes('dev')) applyGuacamolePatch(path.resolve(__dirname, '..'));
}

module.exports = { applyGuacamolePatch, applyNodePtyPatch };

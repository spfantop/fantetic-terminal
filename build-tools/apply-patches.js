const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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
  // Production Docker stages copy the verified patched module from the builder;
  // they must not require Git (or any development patch tooling) at runtime.
  const omitted = (process.env.npm_config_omit ?? '').split(/[\s,]+/);
  if (!omitted.includes('dev')) applyGuacamolePatch(path.resolve(__dirname, '..'));
}

module.exports = { applyGuacamolePatch };

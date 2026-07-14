const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const gatewayDir = path.join(rootDir, 'packages', 'remote-gateway');
const guacamoleLiteDir = path.join(gatewayDir, 'node_modules', 'guacamole-lite');
const patchPackageEntry = path.join(rootDir, 'node_modules', 'patch-package', 'dist', 'index.js');

// The backend production image omits development tools and the remote gateway package.
if (!fs.existsSync(guacamoleLiteDir) || !fs.existsSync(patchPackageEntry)) {
  process.exit(0);
}

execFileSync(process.execPath, [patchPackageEntry, '--patch-dir', 'patches', '--error-on-fail'], {
  cwd: gatewayDir,
  stdio: 'inherit',
});

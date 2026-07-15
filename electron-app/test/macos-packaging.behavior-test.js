const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/desktop-build.yml'), 'utf8');
const cleanupScriptPath = path.join(__dirname, '../build-tools/cleanup-dmg-mounts.sh');

assert.match(workflow, /\$maxPackagingAttempts = if \('\$\{\{ runner\.os \}\}' -eq 'macOS'\) \{ 2 \} else \{ 1 \}/);
assert.match(workflow, /bash electron-app\/build-tools\/cleanup-dmg-mounts\.sh/);

const cleanupScript = fs.readFileSync(cleanupScriptPath, 'utf8');
assert.match(cleanupScript, /\['hdiutil', 'info', '-plist'\]/);
assert.match(cleanupScript, /\/Volumes\/Fantetic Terminal/);
assert.match(cleanupScript, /hdiutil', 'detach', '-force'/);

console.log('macOS packaging recovery behavior passed');

const assert = require('node:assert/strict');
const packageJson = require('../package.json');

assert.deepEqual(packageJson.build.win.target, ['nsis', 'portable']);
assert.match(packageJson.scripts['build:windows'], /electron-builder --win --x64/);
assert.match(packageJson.build.nsis.artifactName, /setup/);
assert.match(packageJson.build.portable.artifactName, /portable/);
assert.ok(packageJson.build.files.includes('service-readiness.js'));

console.log('windows packaging behavior passed');

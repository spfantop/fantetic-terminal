const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const { collectTestScripts } = require('../workspace-test-suite');
const source = readFileSync(resolve(__dirname, '..', 'workspace-test-suite.js'), 'utf8');

assert.deepEqual(
  collectTestScripts({
    scripts: {
      test: 'node build-tools/workspace-test-suite.js',
      'test:security': 'node security.js',
      'test:auth': 'node auth.js',
      build: 'node build.js',
    },
  }),
  ['test:auth', 'test:security'],
);

assert.deepEqual(collectTestScripts({ scripts: { test: 'node test.js' } }), []);
assert.match(source, /process\.env\.ComSpec \?\? 'cmd\.exe'/);
assert.doesNotMatch(source, /shell:\s*process\.platform === 'win32'/);

console.log('workspace test suite behavior passed');

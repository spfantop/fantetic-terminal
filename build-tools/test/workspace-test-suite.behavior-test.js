const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const {
  WorkspaceTestSuiteError,
  collectTestGroups,
  collectTestScripts,
  runWorkspaceTests,
} = require('../workspace-test-suite');
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

for (const workspaceName of ['backend', 'contracts', 'frontend', 'remote-gateway']) {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'packages', workspaceName, 'package.json'), 'utf8'));
  for (const scriptName of collectTestScripts(manifest)) {
    assert.doesNotMatch(
      manifest.scripts[scriptName],
      /\bnpm(?:\.cmd)?\s+run\s+test:/,
      `${manifest.name} ${scriptName} must not invoke another discovered test group`,
    );
  }
}

assert.match(source, /process\.env\.ComSpec \?\? 'cmd\.exe'/);
assert.doesNotMatch(source, /shell:\s*process\.platform === 'win32'/);

const runBehavior = async () => {
  const testGroupList = collectTestGroups();
  assert.ok(testGroupList.length >= 3);
  assert.equal(new Set(testGroupList.map(group => group.id)).size, testGroupList.length);

  let activeGroupCount = 0;
  let maximumActiveGroupCount = 0;
  const resultList = await runWorkspaceTests({
    maximumConcurrency: 2,
    executeGroup: async (group) => {
      activeGroupCount += 1;
      maximumActiveGroupCount = Math.max(maximumActiveGroupCount, activeGroupCount);
      await new Promise(resolvePromise => setTimeout(resolvePromise, group.index % 2 === 0 ? 5 : 1));
      activeGroupCount -= 1;
      return { group, durationMs: 1, output: '', failureList: [] };
    },
    writeOutput: () => {},
  });
  assert.equal(maximumActiveGroupCount, 2);
  assert.deepEqual(resultList.map(result => result.group.id), testGroupList.map(group => group.id));

  const executedGroupIdSet = new Set();
  await assert.rejects(
    runWorkspaceTests({
      maximumConcurrency: 3,
      executeGroup: async (group) => {
        executedGroupIdSet.add(group.id);
        return {
          group,
          durationMs: 1,
          output: '',
          failureList: group.index === 0 ? [{ command: group.commandList[0], exitCode: 1 }] : [],
        };
      },
      writeOutput: () => {},
    }),
    error => error instanceof WorkspaceTestSuiteError && error.resultList.length === testGroupList.length,
  );
  assert.equal(executedGroupIdSet.size, testGroupList.length);

  console.log('workspace test suite behavior passed');
};

runBehavior().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

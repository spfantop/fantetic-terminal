const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  createDockerReleaseManifest,
  prepareDockerReleaseSet,
  promoteDockerReleaseSet,
} = require('../docker-release-set');

const rootDirectory = path.resolve(__dirname, '..', '..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(rootDirectory, 'package.json'), 'utf8'));
const electronPackage = JSON.parse(
  fs.readFileSync(path.join(rootDirectory, 'electron-app', 'package.json'), 'utf8'),
);
const projectVersion = rootPackage.version;
const escapedProjectVersion = projectVersion.replaceAll('.', '\\.');
const [majorVersion, minorVersion, patchVersion] = projectVersion.split('.').map(Number);
const differentVersion = `${majorVersion}.${minorVersion}.${patchVersion + 1}`;
const preparedSet = prepareDockerReleaseSet({
  releaseReference: `v${projectVersion}`,
  packageVersion: projectVersion,
  electronVersion: electronPackage.version,
  runId: '42',
  runAttempt: '3',
  sourceRevision: '0123456789abcdef',
});
const environmentExample = fs.readFileSync(path.join(rootDirectory, '.env.example'), 'utf8');
assert.match(
  environmentExample,
  new RegExp(`^FANTETIC_VERSION=${rootPackage.version}$`, 'm'),
  'the deployment example must advance with the project release version',
);

assert.equal(preparedSet.version, projectVersion);
assert.equal(preparedSet.namespace, 'spfantop');
assert.deepEqual(
  preparedSet.imageList.map(image => image.name),
  ['frontend', 'backend', 'remote-gateway', 'all-in-one'],
);
assert.throws(
  () => prepareDockerReleaseSet({
    releaseReference: differentVersion,
    packageVersion: projectVersion,
    electronVersion: electronPackage.version,
    runId: '42',
    runAttempt: '3',
    sourceRevision: '0123456789abcdef',
  }),
  /must match package version/,
);

const recordList = preparedSet.imageList.map((image, index) => ({
  name: image.name,
  repository: image.repository,
  digest: `sha256:${String(index + 1).repeat(64)}`,
}));
const manifest = createDockerReleaseManifest(preparedSet, recordList);
assert.equal(manifest.buildIdentity, '42-3');
assert.ok(
  manifest.imageList.every(image => image.candidateReference.endsWith(`@${image.digest}`)),
  'candidates must remain digest-only until the complete release set passes preflight',
);
assert.throws(
  () => createDockerReleaseManifest(preparedSet, recordList.slice(1)),
  /exactly one candidate/,
);

const requiredPlatformList = ['linux/amd64', 'linux/arm64'];
const createAdapter = ({
  conflictingImageName,
  missingPlatformImageName,
  malformedTargetImageName,
} = {}) => {
  const descriptorByReference = new Map();
  const createEventList = [];
  for (const image of manifest.imageList) {
    descriptorByReference.set(image.candidateReference, {
      digest: image.digest,
      platformList: image.name === missingPlatformImageName ? ['linux/amd64'] : requiredPlatformList,
    });
    if (image.name === conflictingImageName) {
      descriptorByReference.set(image.versionReference, {
        digest: `sha256:${'f'.repeat(64)}`,
        platformList: requiredPlatformList,
      });
    } else if (image.name === malformedTargetImageName) {
      descriptorByReference.set(image.versionReference, {
        digest: image.digest,
        platformList: ['linux/amd64'],
      });
    }
  }
  return {
    createEventList,
    inspect: reference => descriptorByReference.get(reference) ?? null,
    createTag: (sourceReference, targetReference) => {
      createEventList.push({ sourceReference, targetReference });
      descriptorByReference.set(targetReference, descriptorByReference.get(sourceReference));
    },
  };
};

const conflictingAdapter = createAdapter({ conflictingImageName: 'all-in-one' });
assert.throws(
  () => promoteDockerReleaseSet(manifest, conflictingAdapter),
  /immutable version tag/,
);
assert.deepEqual(
  conflictingAdapter.createEventList,
  [],
  'every candidate and target must pass preflight before promotion writes the first tag',
);

const incompleteManifestAdapter = createAdapter();
assert.throws(
  () => promoteDockerReleaseSet({
    ...manifest,
    imageList: manifest.imageList.slice(1),
  }, incompleteManifestAdapter),
  /exactly one candidate/,
);
assert.deepEqual(incompleteManifestAdapter.createEventList, []);

const tamperedManifestAdapter = createAdapter();
assert.throws(
  () => promoteDockerReleaseSet({ ...manifest, namespace: 'another-user' }, tamperedManifestAdapter),
  /official namespace/,
);
assert.deepEqual(tamperedManifestAdapter.createEventList, []);

const incompletePlatformAdapter = createAdapter({ missingPlatformImageName: 'backend' });
assert.throws(
  () => promoteDockerReleaseSet(manifest, incompletePlatformAdapter),
  /linux\/arm64/,
);
assert.deepEqual(incompletePlatformAdapter.createEventList, []);

const malformedExistingTargetAdapter = createAdapter({ malformedTargetImageName: 'backend' });
assert.throws(
  () => promoteDockerReleaseSet(manifest, malformedExistingTargetAdapter),
  /linux\/arm64/,
);
assert.deepEqual(
  malformedExistingTargetAdapter.createEventList,
  [],
  'all existing targets must pass platform preflight before promotion writes the first tag',
);

const adapter = createAdapter();
const promotedManifest = promoteDockerReleaseSet(manifest, adapter);
assert.deepEqual(
  adapter.createEventList.map(event => event.targetReference),
  [
    ...manifest.imageList.map(image => image.versionReference),
    'spfantop/fantetic-terminal:latest',
  ],
  'latest is promoted only for the standalone image after the complete version set',
);
assert.equal(promotedManifest.status, 'complete');
assert.ok(promotedManifest.imageList.every(image => image.platformList.length === 2));
assert.equal(promotedManifest.buildIdentity, '42-3');

const invalidDesktopTagResult = spawnSync(
  process.execPath,
  [path.resolve(__dirname, '..', 'validate-release-version.js')],
  {
    env: { ...process.env, RELEASE_TAG: projectVersion },
    encoding: 'utf8',
  },
);
assert.notEqual(invalidDesktopTagResult.status, 0, 'desktop release tags must retain the v prefix');
assert.match(invalidDesktopTagResult.stderr, new RegExp(`must match package version v${escapedProjectVersion}`));

const cliDirectory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fantetic-release-set-'));
try {
  const preparedPath = path.join(cliDirectory, 'prepared.json');
  const githubOutputPath = path.join(cliDirectory, 'github-output.txt');
  const prepareResult = spawnSync(
    process.execPath,
    [
      path.join(rootDirectory, 'build-tools', 'docker-release-set.js'),
      'prepare',
      '--release-reference', `v${projectVersion}`,
      '--run-id', '42',
      '--run-attempt', '3',
      '--source-revision', '0123456789abcdef',
      '--output', preparedPath,
      '--github-output', githubOutputPath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(prepareResult.status, 0, prepareResult.stderr);
  const githubOutput = fs.readFileSync(githubOutputPath, 'utf8');
  assert.match(githubOutput, new RegExp(`^version=${escapedProjectVersion}$`, 'm'));
  const matrixLine = githubOutput.split(/\r?\n/).find(line => line.startsWith('matrix='));
  assert.equal(JSON.parse(matrixLine.slice('matrix='.length)).include.length, 4);

  const recordDirectory = path.join(cliDirectory, 'records');
  for (const [index, image] of preparedSet.imageList.entries()) {
    const recordResult = spawnSync(
      process.execPath,
      [
        path.join(rootDirectory, 'build-tools', 'docker-release-set.js'),
        'record',
        '--name', image.name,
        '--repository', image.repository,
        '--digest', `sha256:${String(index + 1).repeat(64)}`,
        '--output', path.join(recordDirectory, `${image.name}.json`),
      ],
      { encoding: 'utf8' },
    );
    assert.equal(recordResult.status, 0, recordResult.stderr);
  }

  const candidatePath = path.join(cliDirectory, 'candidate.json');
  const assembleResult = spawnSync(
    process.execPath,
    [
      path.join(rootDirectory, 'build-tools', 'docker-release-set.js'),
      'assemble',
      '--release-set', preparedPath,
      '--records', recordDirectory,
      '--output', candidatePath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(assembleResult.status, 0, assembleResult.stderr);
  const assembledManifest = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
  assert.equal(assembledManifest.status, 'candidate');
  assert.equal(assembledManifest.buildIdentity, '42-3');
  assert.equal(assembledManifest.imageList.length, 4);
} finally {
  fs.rmSync(cliDirectory, { recursive: true, force: true });
}

console.log('Docker release set behavior passed');

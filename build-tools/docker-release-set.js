const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  readProjectVersionSet,
  validateProjectReleaseVersion,
} = require('./release-version');

const OFFICIAL_NAMESPACE = 'spfantop';
const REQUIRED_PLATFORM_LIST = ['linux/amd64', 'linux/arm64'];
const IMAGE_DEFINITION_LIST = [
  {
    name: 'frontend',
    repository: 'fantetic-terminal-frontend',
    dockerfile: 'packages/frontend/Dockerfile',
  },
  {
    name: 'backend',
    repository: 'fantetic-terminal-backend',
    dockerfile: 'packages/backend/Dockerfile',
  },
  {
    name: 'remote-gateway',
    repository: 'fantetic-terminal-remote-gateway',
    dockerfile: 'packages/remote-gateway/Dockerfile',
  },
  {
    name: 'all-in-one',
    repository: 'fantetic-terminal',
    dockerfile: 'packages/single-image/Dockerfile',
  },
];
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const requireMatch = (value, pattern, label) => {
  const normalized = String(value ?? '').trim();
  if (!pattern.test(normalized)) throw new Error(`Invalid ${label}: ${String(value)}`);
  return normalized;
};

const prepareDockerReleaseSet = ({
  releaseReference,
  packageVersion,
  electronVersion,
  runId,
  runAttempt,
  sourceRevision,
}) => {
  const version = validateProjectReleaseVersion({
    packageVersion,
    electronVersion,
    releaseReference,
    stableOnly: true,
  });
  const normalizedRunId = requireMatch(runId, /^\d+$/, 'workflow run id');
  const normalizedRunAttempt = requireMatch(runAttempt, /^\d+$/, 'workflow run attempt');
  const normalizedRevision = requireMatch(sourceRevision, /^[a-f0-9]{7,64}$/i, 'source revision');

  return {
    schemaVersion: 1,
    status: 'prepared',
    namespace: OFFICIAL_NAMESPACE,
    version,
    buildIdentity: `${normalizedRunId}-${normalizedRunAttempt}`,
    sourceRevision: normalizedRevision,
    imageList: IMAGE_DEFINITION_LIST.map(image => ({
      ...image,
      versionReference: `${OFFICIAL_NAMESPACE}/${image.repository}:${version}`,
    })),
  };
};

const validateDigest = (digest, label) => requireMatch(digest, DIGEST_PATTERN, `${label} digest`);

const createDockerReleaseManifest = (preparedSet, recordList) => {
  if (
    !preparedSet
    || preparedSet.schemaVersion !== 1
    || preparedSet.status !== 'prepared'
    || preparedSet.namespace !== OFFICIAL_NAMESPACE
    || !VERSION_PATTERN.test(preparedSet.version)
    || !/^\d+-\d+$/.test(preparedSet.buildIdentity)
    || !/^[a-f0-9]{7,64}$/i.test(preparedSet.sourceRevision)
  ) {
    throw new Error('Docker release set must be prepared before candidate records are collected.');
  }
  if (!Array.isArray(recordList) || recordList.length !== preparedSet.imageList.length) {
    throw new Error('Docker release set requires exactly one candidate for every image.');
  }

  const recordByName = new Map();
  for (const record of recordList) {
    if (!record || typeof record.name !== 'string' || recordByName.has(record.name)) {
      throw new Error('Docker release set requires exactly one candidate for every image.');
    }
    recordByName.set(record.name, record);
  }

  const imageList = preparedSet.imageList.map(image => {
    const record = recordByName.get(image.name);
    if (!record || record.repository !== image.repository) {
      throw new Error(`Docker release set requires exactly one candidate for ${image.name}.`);
    }
    return {
      name: image.name,
      repository: image.repository,
      candidateReference: `${preparedSet.namespace}/${image.repository}@${validateDigest(record.digest, image.name)}`,
      versionReference: image.versionReference,
      digest: validateDigest(record.digest, image.name),
    };
  });

  return {
    schemaVersion: preparedSet.schemaVersion,
    status: 'candidate',
    namespace: preparedSet.namespace,
    version: preparedSet.version,
    buildIdentity: preparedSet.buildIdentity,
    sourceRevision: preparedSet.sourceRevision,
    imageList,
  };
};

const validateDescriptor = (image, descriptor) => {
  if (!descriptor) throw new Error(`Candidate image is unavailable: ${image.candidateReference}`);
  if (descriptor.digest !== image.digest) {
    throw new Error(`Candidate digest changed for ${image.name}: ${descriptor.digest}`);
  }
  const platformSet = new Set(descriptor.platformList ?? []);
  for (const platform of REQUIRED_PLATFORM_LIST) {
    if (!platformSet.has(platform)) {
      throw new Error(`Candidate ${image.name} is missing required platform ${platform}.`);
    }
  }
  return REQUIRED_PLATFORM_LIST.slice();
};

const validateReleaseManifestImageList = (manifest) => {
  if (!Array.isArray(manifest.imageList) || manifest.imageList.length !== IMAGE_DEFINITION_LIST.length) {
    throw new Error('Docker release set requires exactly one candidate for every image.');
  }
  const imageByName = new Map(manifest.imageList.map(image => [image?.name, image]));
  if (imageByName.size !== IMAGE_DEFINITION_LIST.length) {
    throw new Error('Docker release set requires exactly one candidate for every image.');
  }
  return IMAGE_DEFINITION_LIST.map(definition => {
    const image = imageByName.get(definition.name);
    const expectedVersionReference = `${manifest.namespace}/${definition.repository}:${manifest.version}`;
    const expectedCandidatePrefix = `${manifest.namespace}/${definition.repository}@`;
    if (
      !image
      || image.repository !== definition.repository
      || image.versionReference !== expectedVersionReference
      || !image.candidateReference?.startsWith(expectedCandidatePrefix)
      || image.candidateReference !== `${expectedCandidatePrefix}${image.digest}`
    ) {
      throw new Error(`Docker release set contains an invalid candidate for ${definition.name}.`);
    }
    validateDigest(image.digest, image.name);
    return image;
  });
};

const promoteDockerReleaseSet = (manifest, adapter) => {
  if (
    !manifest
    || manifest.schemaVersion !== 1
    || manifest.status !== 'candidate'
    || manifest.namespace !== OFFICIAL_NAMESPACE
    || !VERSION_PATTERN.test(manifest.version)
    || !/^\d+-\d+$/.test(manifest.buildIdentity)
    || !/^[a-f0-9]{7,64}$/i.test(manifest.sourceRevision)
  ) {
    if (manifest?.namespace !== undefined && manifest.namespace !== OFFICIAL_NAMESPACE) {
      throw new Error(`Docker release set must use the official namespace ${OFFICIAL_NAMESPACE}.`);
    }
    throw new Error('Only a validated candidate Docker release set can be promoted.');
  }

  const imageList = validateReleaseManifestImageList(manifest);
  const candidateDescriptorList = imageList.map(image => {
    const descriptor = adapter.inspect(image.candidateReference);
    return { image, platformList: validateDescriptor(image, descriptor) };
  });
  const targetDescriptorList = imageList.map(image => ({
    image,
    descriptor: adapter.inspect(image.versionReference),
  }));
  for (const { image, descriptor } of targetDescriptorList) {
    if (descriptor && descriptor.digest !== image.digest) {
      throw new Error(`Refusing to replace immutable version tag ${image.versionReference}.`);
    }
    if (descriptor) {
      validateDescriptor({ ...image, candidateReference: image.versionReference }, descriptor);
    }
  }

  for (const { image, descriptor } of targetDescriptorList) {
    if (!descriptor) adapter.createTag(image.candidateReference, image.versionReference);
    const promotedDescriptor = adapter.inspect(image.versionReference);
    validateDescriptor({ ...image, candidateReference: image.versionReference }, promotedDescriptor);
  }

  const allInOneImage = imageList.find(image => image.name === 'all-in-one');
  if (!allInOneImage) throw new Error('Docker release set is missing the all-in-one image.');
  const latestReference = `${manifest.namespace}/${allInOneImage.repository}:latest`;
  adapter.createTag(
    allInOneImage.versionReference,
    latestReference,
  );
  validateDescriptor(
    { ...allInOneImage, candidateReference: latestReference },
    adapter.inspect(latestReference),
  );

  return {
    ...manifest,
    status: 'complete',
    imageList: candidateDescriptorList.map(({ image, platformList }) => ({
      ...image,
      platformList,
    })),
  };
};

const parseArguments = (argumentList) => {
  const optionMap = new Map();
  for (let index = 0; index < argumentList.length; index += 2) {
    const name = argumentList[index];
    const value = argumentList[index + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid command option near ${String(name)}.`);
    }
    optionMap.set(name.slice(2), value);
  }
  return optionMap;
};

const requiredOption = (optionMap, name) => {
  const value = optionMap.get(name);
  if (!value) throw new Error(`Missing required --${name} option.`);
  return value;
};

const writeJson = (filePath, value) => {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, absolutePath);
};

const readJson = filePath => JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));

const runDocker = (argumentList, { allowMissing = false } = {}) => {
  const result = spawnSync('docker', argumentList, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status === 0) return result.stdout;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  if (allowMissing && /manifest unknown|no such manifest|not found/i.test(output)) return null;
  throw new Error(`docker ${argumentList.join(' ')} failed: ${output}`);
};

const createDockerAdapter = () => ({
  inspect: reference => {
    const output = runDocker(
      ['buildx', 'imagetools', 'inspect', reference, '--format', '{{json .Manifest}}'],
      { allowMissing: true },
    );
    if (output === null) return null;
    const manifest = JSON.parse(output);
    return {
      digest: manifest.digest,
      platformList: (manifest.manifests ?? [])
        .map(item => `${item.platform?.os}/${item.platform?.architecture}`),
    };
  },
  createTag: (sourceReference, targetReference) => {
    runDocker(['buildx', 'imagetools', 'create', '--tag', targetReference, sourceReference]);
  },
});

const executeCommand = (command, optionMap) => {
  if (command === 'prepare') {
    const rootDirectory = path.resolve(__dirname, '..');
    const versionSet = readProjectVersionSet(rootDirectory);
    const preparedSet = prepareDockerReleaseSet({
      ...versionSet,
      releaseReference: requiredOption(optionMap, 'release-reference'),
      runId: requiredOption(optionMap, 'run-id'),
      runAttempt: requiredOption(optionMap, 'run-attempt'),
      sourceRevision: requiredOption(optionMap, 'source-revision'),
    });
    writeJson(requiredOption(optionMap, 'output'), preparedSet);
    const githubOutput = optionMap.get('github-output');
    if (githubOutput) {
      const matrix = preparedSet.imageList.map(({ name, repository, dockerfile }) => ({
        name,
        repository,
        dockerfile,
      }));
      fs.appendFileSync(
        githubOutput,
        `version=${preparedSet.version}\nmatrix=${JSON.stringify({ include: matrix })}\n`,
        'utf8',
      );
    }
    return;
  }

  if (command === 'record') {
    const record = {
      name: requiredOption(optionMap, 'name'),
      repository: requiredOption(optionMap, 'repository'),
      digest: validateDigest(requiredOption(optionMap, 'digest'), requiredOption(optionMap, 'name')),
    };
    writeJson(requiredOption(optionMap, 'output'), record);
    return;
  }

  if (command === 'assemble') {
    const preparedSet = readJson(requiredOption(optionMap, 'release-set'));
    const recordsDirectory = path.resolve(requiredOption(optionMap, 'records'));
    const recordList = preparedSet.imageList.map(image => (
      readJson(path.join(recordsDirectory, `${image.name}.json`))
    ));
    writeJson(
      requiredOption(optionMap, 'output'),
      createDockerReleaseManifest(preparedSet, recordList),
    );
    return;
  }

  if (command === 'promote') {
    const manifest = readJson(requiredOption(optionMap, 'manifest'));
    const completedManifest = promoteDockerReleaseSet(manifest, createDockerAdapter());
    writeJson(requiredOption(optionMap, 'output'), completedManifest);
    return;
  }

  throw new Error(`Unknown Docker release set command: ${String(command)}`);
};

if (require.main === module) {
  try {
    const [command, ...argumentList] = process.argv.slice(2);
    executeCommand(command, parseArguments(argumentList));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = {
  createDockerReleaseManifest,
  prepareDockerReleaseSet,
  promoteDockerReleaseSet,
};

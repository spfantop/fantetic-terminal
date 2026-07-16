const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const secretPatternList = [
  { kind: 'private-key', pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  { kind: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { kind: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/ },
  {
    kind: 'runtime-secret',
    pattern: /(?:ENCRYPTION_KEY|SESSION_SECRET|REMOTE_GATEWAY_SHARED_SECRET)\s*[:=]\s*['"]?(?!\$\{|\{\{|changeme|replace-me|example)[A-Za-z0-9+/_=-]{24,}/i,
  },
];

const scanText = (file, text) => secretPatternList
  .filter(({ pattern }) => pattern.test(text))
  .map(({ kind }) => ({ file, kind }));

const readTrackedFileList = (rootDirectory) => execFileSync(
  'git',
  ['ls-files', '-z'],
  { cwd: rootDirectory, encoding: 'utf8' },
).split('\0').filter(Boolean);

const scanTrackedFiles = (rootDirectory = resolve(__dirname, '..')) => {
  const findingList = [];
  for (const relativePath of readTrackedFileList(rootDirectory)) {
    try {
      findingList.push(...scanText(relativePath, readFileSync(resolve(rootDirectory, relativePath), 'utf8')));
    } catch (error) {
      if (error && error.code === 'ERR_INVALID_ARG_VALUE') continue;
      throw error;
    }
  }
  return findingList;
};

if (require.main === module) {
  const findingList = scanTrackedFiles();
  if (findingList.length > 0) {
    console.error('Potential committed secrets found:', findingList);
    process.exitCode = 1;
  } else {
    console.log('No committed secrets detected');
  }
}

module.exports = { scanText, scanTrackedFiles };

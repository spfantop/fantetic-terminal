import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const aboutSection = fs.readFileSync(path.resolve('src/components/settings/AboutSection.vue'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.resolve('../../package.json'), 'utf8'));
const repositoryUrl = packageJson.repository.url
  .replace(/^git\+/, '')
  .replace(/\.git$/, '');

assert.match(aboutSection, /useVersionCheck/);
assert.match(aboutSection, /GITHUB_REPO_URL/);
assert.match(aboutSection, /settings\.about\.updateAvailable/);

const constantsPath = path.resolve('src/utils/constants.ts');
assert.equal(fs.existsSync(constantsPath), true);
const constantsSource = fs.readFileSync(constantsPath, 'utf8');
assert.match(constantsSource, new RegExp(repositoryUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

const versionCheckPath = path.resolve('src/composables/settings/useVersionCheck.ts');
assert.equal(fs.existsSync(versionCheckPath), true);
const versionCheckSource = fs.readFileSync(versionCheckPath, 'utf8');
assert.match(versionCheckSource, /\/VERSION/);
assert.match(versionCheckSource, /\/api\/v1\/version\/remote/);

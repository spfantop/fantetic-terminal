const assert = require('node:assert/strict');
const { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { applyGuacamolePatch } = require('../apply-patches');

const root = mkdtempSync(path.join(tmpdir(), 'fantetic-patch-test-'));
try {
  const gateway = path.join(root, 'packages/remote-gateway');
  mkdirSync(gateway, { recursive: true });
  mkdirSync(path.join(gateway, 'node_modules'), { recursive: true });
  cpSync(path.resolve('packages/remote-gateway/node_modules/guacamole-lite'), path.join(gateway, 'node_modules/guacamole-lite'), { recursive: true });
  cpSync(path.resolve('packages/remote-gateway/patches'), path.join(gateway, 'patches'), { recursive: true });
  const patch = path.join(gateway, 'patches/guacamole-lite+1.2.0.patch');
  const options = { cwd: gateway, stdio: 'pipe', env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(gateway) } };
  execFileSync('git', ['init', '--quiet', root], { stdio: 'pipe' });
  writeFileSync(patch, readFileSync(patch, 'utf8').replace(/\r\n/g, '\n'));
  // Start from the original dependency, using the inverse of the repository patch.
  execFileSync('git', ['apply', '--recount', '--reverse', patch], options);
  applyGuacamolePatch(root);
  execFileSync('git', ['apply', '--recount', '--reverse', '--check', patch], options);
  applyGuacamolePatch(root);
  execFileSync('git', ['apply', '--recount', '--reverse', '--check', patch], options);
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = '';
    assert.throws(() => applyGuacamolePatch(root), /ENOENT/, 'Git missing during build must fail');
  } finally {
    process.env.PATH = originalPath;
  }
  execFileSync(process.execPath, [path.resolve('build-tools/apply-patches.js')], {
    env: { ...process.env, npm_config_omit: 'dev', PATH: '' }, stdio: 'pipe',
  });
  const cryptPath = path.join(gateway, 'node_modules/guacamole-lite/lib/Crypt.js');
  writeFileSync(cryptPath, readFileSync(cryptPath, 'utf8').replace('decrypt(encodedString)', 'decryptIncompatible(encodedString)'));
  assert.throws(() => applyGuacamolePatch(root), /patch|apply/i, 'unexpected upstream content must fail, never silently skip');
  console.log('dependency patch applies, remains idempotent and rejects incompatible files');
} finally {
  rmSync(root, { recursive: true, force: true });
}

const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { gzipSync } = require('node:zlib');

const { inspectInitialAssets } = require('../check-frontend-bundle-budget');

const distDirectory = mkdtempSync(join(tmpdir(), 'fantetic-frontend-budget-'));
const assetsDirectory = join(distDirectory, 'assets');
mkdirSync(assetsDirectory);

try {
  writeFileSync(join(assetsDirectory, 'entry.js'), 'x'.repeat(1_000));
  writeFileSync(join(assetsDirectory, 'entry.css'), 'y'.repeat(1_000));
  writeFileSync(join(assetsDirectory, 'lazy.js'), 'z'.repeat(20_000));
  writeFileSync(join(assetsDirectory, 'zh-CN-test.js'), '中'.repeat(20_000));
  writeFileSync(join(assetsDirectory, 'ja-JP-test.js'), '日'.repeat(20_000));
  writeFileSync(join(distDirectory, 'index.html'), [
    '<script type="module" src="/assets/entry.js"></script>',
    '<link rel="stylesheet" href="/assets/entry.css">',
  ].join('\n'));

  const report = inspectInitialAssets(distDirectory, { javascript: 100, css: 100 });
  assert.equal(report.javascript.gzipBytes, gzipSync(Buffer.from('x'.repeat(1_000))).length);
  assert.equal(report.css.gzipBytes, gzipSync(Buffer.from('y'.repeat(1_000))).length);
  assert.equal(report.assets.some((asset) => asset.path.endsWith('lazy.js')), false);
  assert.deepEqual(report.localeChunks.map((asset) => asset.locale), ['ja-JP', 'zh-CN']);
  assert.equal(report.localeJavascript.budgetBytes, 36 * 1024);
  assert.equal(report.passes, true, 'only assets requested by index.html count toward the first-screen budget');

  const oversizedReport = inspectInitialAssets(distDirectory, { javascript: 10, css: 100, localeJavascript: 1_000 });
  assert.equal(oversizedReport.passes, false);
  assert.match(oversizedReport.failures[0], /JavaScript gzip budget exceeded/);

  const oversizedLocaleReport = inspectInitialAssets(distDirectory, { javascript: 100, css: 100, localeJavascript: 10 });
  assert.equal(oversizedLocaleReport.passes, false);
  assert.match(oversizedLocaleReport.failures[0], /locale chunk gzip budget exceeded/);

  writeFileSync(join(distDirectory, 'index.html'), [
    '<script type="module" src="/assets/entry.js"></script>',
    '<link rel="modulepreload" href="/assets/zh-CN-test.js">',
    '<link rel="stylesheet" href="/assets/entry.css">',
  ].join('\n'));
  const eagerLocaleReport = inspectInitialAssets(distDirectory, { javascript: 1_000, css: 100, localeJavascript: 1_000 });
  assert.equal(eagerLocaleReport.passes, false);
  assert.match(eagerLocaleReport.failures[0], /must not be part of the initial asset graph/);
} finally {
  rmSync(distDirectory, { recursive: true, force: true });
}

console.log('frontend bundle budget behavior ok');

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
  writeFileSync(join(assetsDirectory, 'AddConnectionForm-test.js'), 'a'.repeat(20_000));
  writeFileSync(join(assetsDirectory, 'BatchEditConnectionForm-test.js'), 'b'.repeat(10_000));
  writeFileSync(join(assetsDirectory, 'zh-CN-test.js'), '中'.repeat(20_000));
  writeFileSync(join(assetsDirectory, 'ja-JP-test.js'), '日'.repeat(20_000));
  writeFileSync(join(distDirectory, 'index.html'), [
    '<script type="module" src="/assets/entry.js"></script>',
    '<link rel="stylesheet" href="/assets/entry.css">',
  ].join('\n'));

  const report = inspectInitialAssets(distDirectory, {
    javascript: 100,
    css: 100,
    connectionFormJavascript: 1_000,
  });
  assert.equal(report.javascript.gzipBytes, gzipSync(Buffer.from('x'.repeat(1_000))).length);
  assert.equal(report.css.gzipBytes, gzipSync(Buffer.from('y'.repeat(1_000))).length);
  assert.equal(report.assets.some((asset) => asset.path.endsWith('lazy.js')), false);
  assert.deepEqual(report.localeChunks.map((asset) => asset.locale), ['ja-JP', 'zh-CN']);
  assert.equal(report.localeJavascript.budgetBytes, 36 * 1024);
  assert.deepEqual(
    report.connectionFormChunks.map((asset) => asset.feature),
    ['AddConnectionForm', 'BatchEditConnectionForm'],
  );
  assert.equal(
    report.connectionFormJavascript.gzipBytes,
    gzipSync(Buffer.from('a'.repeat(20_000))).length + gzipSync(Buffer.from('b'.repeat(10_000))).length,
  );
  assert.equal(report.passes, true, 'only assets requested by index.html count toward the first-screen budget');

  const oversizedReport = inspectInitialAssets(distDirectory, { javascript: 10, css: 100, localeJavascript: 1_000 });
  assert.equal(oversizedReport.passes, false);
  assert.match(oversizedReport.failures[0], /JavaScript gzip budget exceeded/);

  const oversizedLocaleReport = inspectInitialAssets(distDirectory, { javascript: 100, css: 100, localeJavascript: 10 });
  assert.equal(oversizedLocaleReport.passes, false);
  assert.match(oversizedLocaleReport.failures[0], /locale chunk gzip budget exceeded/);

  const oversizedConnectionFormReport = inspectInitialAssets(distDirectory, {
    javascript: 100,
    css: 100,
    connectionFormJavascript: 10,
  });
  assert.equal(oversizedConnectionFormReport.passes, false);
  assert.ok(oversizedConnectionFormReport.failures.some(failure => /Connection form chunks gzip budget exceeded/.test(failure)));

  writeFileSync(join(distDirectory, 'index.html'), [
    '<script type="module" src="/assets/entry.js"></script>',
    '<link rel="modulepreload" href="/assets/zh-CN-test.js">',
    '<link rel="modulepreload" href="/assets/AddConnectionForm-test.js">',
    '<link rel="stylesheet" href="/assets/entry.css">',
  ].join('\n'));
  const eagerLocaleReport = inspectInitialAssets(distDirectory, { javascript: 1_000, css: 100, localeJavascript: 1_000 });
  assert.equal(eagerLocaleReport.passes, false);
  assert.match(eagerLocaleReport.failures[0], /must not be part of the initial asset graph/);
  assert.ok(eagerLocaleReport.failures.some(failure => /AddConnectionForm lazy chunk must not be part of the initial asset graph/.test(failure)));

  rmSync(join(assetsDirectory, 'BatchEditConnectionForm-test.js'));
  const missingConnectionFormReport = inspectInitialAssets(distDirectory, {
    javascript: 1_000,
    css: 100,
    localeJavascript: 1_000,
    connectionFormJavascript: 1_000,
  });
  assert.equal(missingConnectionFormReport.passes, false);
  assert.ok(missingConnectionFormReport.failures.some(failure => /BatchEditConnectionForm lazy chunk is missing/.test(failure)));
} finally {
  rmSync(distDirectory, { recursive: true, force: true });
}

console.log('frontend bundle budget behavior ok');

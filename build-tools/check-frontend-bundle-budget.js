const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { gzipSync } = require('node:zlib');

const DEFAULT_BUDGET_BYTES = Object.freeze({
  javascript: 300 * 1024,
  css: 48 * 1024,
  localeJavascript: 36 * 1024,
});

const LAZY_LOCALE_LIST = Object.freeze(['ja-JP', 'zh-CN']);

const initialAssetPathList = (html) => [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)]
  .map((match) => match[1].slice(1));

const inspectInitialAssets = (distDirectory, budget = DEFAULT_BUDGET_BYTES) => {
  const effectiveBudget = { ...DEFAULT_BUDGET_BYTES, ...budget };
  const html = readFileSync(resolve(distDirectory, 'index.html'), 'utf8');
  const assetList = initialAssetPathList(html).map((assetPath) => {
    const content = readFileSync(resolve(distDirectory, assetPath));
    const type = assetPath.endsWith('.css') ? 'css' : 'javascript';
    return { path: assetPath, type, gzipBytes: gzipSync(content).length };
  });

  const gzipBytesByType = assetList.reduce((total, asset) => {
    total[asset.type] += asset.gzipBytes;
    return total;
  }, { javascript: 0, css: 0 });
  const localeChunks = readdirSync(resolve(distDirectory, 'assets'))
    .map(fileName => {
      const locale = LAZY_LOCALE_LIST.find(candidate => fileName.startsWith(`${candidate}-`));
      if (!locale || !fileName.endsWith('.js')) return null;
      const assetPath = `assets/${fileName}`;
      return { locale, path: assetPath, gzipBytes: gzipSync(readFileSync(resolve(distDirectory, assetPath))).length };
    })
    .filter(Boolean)
    .sort((left, right) => left.locale.localeCompare(right.locale));
  const failures = Object.entries(effectiveBudget)
    .filter(([type, limit]) => type !== 'localeJavascript' && gzipBytesByType[type] > limit)
    .map(([type, limit]) => `${type === 'javascript' ? 'JavaScript' : 'CSS'} gzip budget exceeded: ${gzipBytesByType[type]} B > ${limit} B`);
  for (const locale of LAZY_LOCALE_LIST) {
    const localeChunk = localeChunks.find(chunk => chunk.locale === locale);
    if (!localeChunk) {
      failures.push(`${locale} locale chunk is missing.`);
    } else if (localeChunk.gzipBytes > effectiveBudget.localeJavascript) {
      failures.push(`${locale} locale chunk gzip budget exceeded: ${localeChunk.gzipBytes} B > ${effectiveBudget.localeJavascript} B`);
    }
    if (localeChunk && assetList.some(asset => asset.path === localeChunk.path)) {
      failures.push(`${locale} locale chunk must not be part of the initial asset graph.`);
    }
  }

  return {
    assets: assetList,
    localeChunks,
    javascript: { gzipBytes: gzipBytesByType.javascript, budgetBytes: effectiveBudget.javascript },
    css: { gzipBytes: gzipBytesByType.css, budgetBytes: effectiveBudget.css },
    localeJavascript: { budgetBytes: effectiveBudget.localeJavascript },
    failures,
    passes: failures.length === 0,
  };
};

const report = (result) => {
  for (const type of ['javascript', 'css']) {
    const value = result[type];
    console.log(`Initial ${type} gzip: ${value.gzipBytes} B / ${value.budgetBytes} B`);
  }
  for (const chunk of result.localeChunks) {
    console.log(`${chunk.locale} locale gzip: ${chunk.gzipBytes} B / ${result.localeJavascript.budgetBytes} B`);
  }
  if (!result.passes) throw new Error(result.failures.join('\n'));
};

if (require.main === module) report(inspectInitialAssets(process.argv[2] ?? 'dist'));

module.exports = { DEFAULT_BUDGET_BYTES, initialAssetPathList, inspectInitialAssets };

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { gzipSync } = require('node:zlib');

const DEFAULT_BUDGET_BYTES = Object.freeze({
  javascript: 450 * 1024,
  css: 48 * 1024,
});

const initialAssetPathList = (html) => [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)]
  .map((match) => match[1].slice(1));

const inspectInitialAssets = (distDirectory, budget = DEFAULT_BUDGET_BYTES) => {
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
  const failures = Object.entries(budget)
    .filter(([type, limit]) => gzipBytesByType[type] > limit)
    .map(([type, limit]) => `${type === 'javascript' ? 'JavaScript' : 'CSS'} gzip budget exceeded: ${gzipBytesByType[type]} B > ${limit} B`);

  return {
    assets: assetList,
    javascript: { gzipBytes: gzipBytesByType.javascript, budgetBytes: budget.javascript },
    css: { gzipBytes: gzipBytesByType.css, budgetBytes: budget.css },
    failures,
    passes: failures.length === 0,
  };
};

const report = (result) => {
  for (const type of ['javascript', 'css']) {
    const value = result[type];
    console.log(`Initial ${type} gzip: ${value.gzipBytes} B / ${value.budgetBytes} B`);
  }
  if (!result.passes) throw new Error(result.failures.join('\n'));
};

if (require.main === module) report(inspectInitialAssets(process.argv[2] ?? 'dist'));

module.exports = { DEFAULT_BUDGET_BYTES, initialAssetPathList, inspectInitialAssets };

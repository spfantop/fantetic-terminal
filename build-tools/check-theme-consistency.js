const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const BACKEND_PRESET_FILE = 'packages/backend/src/config/preset-themes-definition.ts';
const FRONTEND_PRESET_FILE = 'packages/frontend/src/features/appearance/config/iterm-themes.ts';
const BACKEND_DEFAULT_FILE = 'packages/backend/src/config/default-themes.ts';
const FRONTEND_DEFAULT_FILE = 'packages/frontend/src/features/appearance/config/default-themes.ts';

// 更新预设时必须有意更新该清单，避免两端同时意外删除或篡改同一主题而守卫失效。
const EXPECTED_PRESET_MANIFEST = Object.freeze({
  count: 403,
  hash: 'db356889027bc87f251330a60e8e3dd67c1430bfe48d8c2e7d3c2b016106a42c',
});

const EXPECTED_DEFAULT_THEME_MANIFESTS = Object.freeze({
  defaultXtermTheme: { count: 20, hash: 'fb38b817d1fd7c6d9515c3c0d12b72a382675cec28d193e399fcb312d6d00336' },
  defaultUiTheme: { count: 24, hash: 'f29a180068bb4d72485dba096dfd87ecd1a57f3b0ab5103ab65bf6def373a65b' },
  darkUiTheme: { count: 27, hash: '164e28184f90f95fe6979d597e6c064512c48cac3b215eba57574ac8ff343d38' },
});

const normalizeThemeKey = (name) => String(name)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('en-US')
  .replace(/[\s_-]+/g, '');

const normalizeThemeData = (themeData) => Object.fromEntries(
  Object.entries(themeData ?? {})
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)),
);

const sortValue = (value) => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortValue(nestedValue)]),
    );
  }
  return value;
};

const createValueManifest = (value) => {
  const normalizedValue = sortValue(value);
  return {
    count: Object.keys(normalizedValue ?? {}).length,
    hash: crypto.createHash('sha256').update(JSON.stringify(normalizedValue)).digest('hex'),
  };
};

const compareThemeValues = (backendValue, frontendValue, label) => (
  JSON.stringify(sortValue(backendValue)) === JSON.stringify(sortValue(frontendValue))
    ? null
    : `${label}不一致。`
);

const canonicalizeThemes = (themes, sourceName) => {
  if (!Array.isArray(themes)) {
    throw new Error(`${sourceName} 主题预设不是数组。`);
  }

  const catalog = new Map();
  for (const theme of themes) {
    const key = normalizeThemeKey(theme?.name);
    if (!key) {
      throw new Error(`${sourceName} 存在没有名称的主题预设。`);
    }
    if (catalog.has(key)) {
      throw new Error(`${sourceName} 存在重复主题键：${theme.name}`);
    }
    if (!theme?.isPreset || !theme?.themeData || typeof theme.themeData !== 'object') {
      throw new Error(`${sourceName} 主题 ${theme?.name ?? key} 不是完整预设主题。`);
    }

    catalog.set(key, {
      name: theme.name,
      themeData: normalizeThemeData(theme.themeData),
    });
  }
  return catalog;
};

const compareThemeCatalogs = (backendCatalog, frontendCatalog) => {
  const mismatchList = [];
  const keyList = new Set([...backendCatalog.keys(), ...frontendCatalog.keys()]);
  for (const key of [...keyList].sort()) {
    const backendTheme = backendCatalog.get(key);
    const frontendTheme = frontendCatalog.get(key);
    if (!backendTheme) {
      mismatchList.push(`前端多出主题 ${frontendTheme.name}。`);
      continue;
    }
    if (!frontendTheme) {
      mismatchList.push(`前端缺少主题 ${backendTheme.name}。`);
      continue;
    }
    if (JSON.stringify(backendTheme.themeData) !== JSON.stringify(frontendTheme.themeData)) {
      mismatchList.push(`主题 ${backendTheme.name} 的 themeData 不一致。`);
    }
  }
  return mismatchList;
};

const createThemeManifest = (catalog) => {
  const canonicalThemes = [...catalog.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, theme]) => [key, theme.themeData]);
  return {
    count: canonicalThemes.length,
    hash: crypto.createHash('sha256').update(JSON.stringify(canonicalThemes)).digest('hex'),
  };
};

const loadTypeScriptExport = (filePath, exportName) => {
  const result = esbuild.buildSync({
    entryPoints: [filePath],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    write: false,
    logLevel: 'silent',
  });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
  }, { filename: filePath });
  return module.exports[exportName];
};

const checkThemeConsistency = (rootDirectory = path.resolve(__dirname, '..')) => {
  const backendPath = path.join(rootDirectory, BACKEND_PRESET_FILE);
  const frontendPath = path.join(rootDirectory, FRONTEND_PRESET_FILE);
  const backendDefaultPath = path.join(rootDirectory, BACKEND_DEFAULT_FILE);
  const frontendDefaultPath = path.join(rootDirectory, FRONTEND_DEFAULT_FILE);
  for (const filePath of [backendPath, frontendPath, backendDefaultPath, frontendDefaultPath]) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`主题预设文件不存在：${filePath}`);
    }
  }

  const backendCatalog = canonicalizeThemes(
    loadTypeScriptExport(backendPath, 'presetTerminalThemes'),
    '后端',
  );
  const frontendCatalog = canonicalizeThemes(
    loadTypeScriptExport(frontendPath, 'presetTerminalThemes'),
    '前端',
  );
  const mismatchList = compareThemeCatalogs(backendCatalog, frontendCatalog);
  const backendManifest = createThemeManifest(backendCatalog);
  const frontendManifest = createThemeManifest(frontendCatalog);

  if (backendManifest.count !== frontendManifest.count || backendManifest.hash !== frontendManifest.hash) {
    mismatchList.push(
      `主题清单不一致：后端 ${backendManifest.count}/${backendManifest.hash}，前端 ${frontendManifest.count}/${frontendManifest.hash}。`,
    );
  }
  if (
    backendManifest.count !== EXPECTED_PRESET_MANIFEST.count
    || backendManifest.hash !== EXPECTED_PRESET_MANIFEST.hash
  ) {
    mismatchList.push(
      `后端主题清单偏离基线：期望 ${EXPECTED_PRESET_MANIFEST.count}/${EXPECTED_PRESET_MANIFEST.hash}，实际 ${backendManifest.count}/${backendManifest.hash}。`,
    );
  }

  for (const exportName of Object.keys(EXPECTED_DEFAULT_THEME_MANIFESTS)) {
    const backendValue = loadTypeScriptExport(backendDefaultPath, exportName);
    const frontendValue = loadTypeScriptExport(frontendDefaultPath, exportName);
    const label = exportName === 'defaultXtermTheme'
      ? '默认 xterm 主题'
      : exportName === 'defaultUiTheme'
        ? '默认浅色 UI 主题'
        : '默认深色 UI 主题';
    const difference = compareThemeValues(backendValue, frontendValue, label);
    if (difference) mismatchList.push(difference);

    const manifest = createValueManifest(backendValue);
    const expectedManifest = EXPECTED_DEFAULT_THEME_MANIFESTS[exportName];
    if (manifest.count !== expectedManifest.count || manifest.hash !== expectedManifest.hash) {
      mismatchList.push(
        `${label}偏离基线：期望 ${expectedManifest.count}/${expectedManifest.hash}，实际 ${manifest.count}/${manifest.hash}。`,
      );
    }
  }

  if (mismatchList.length > 0) {
    throw new Error(`终端主题预设一致性检查失败：\n- ${mismatchList.join('\n- ')}`);
  }

  return {
    backend: backendManifest,
    frontend: frontendManifest,
  };
};

if (require.main === module) {
  const result = checkThemeConsistency();
  console.log(`theme consistency ok: ${result.backend.count} themes, ${result.backend.hash}`);
}

module.exports = {
  canonicalizeThemes,
  compareThemeCatalogs,
  compareThemeValues,
  createThemeManifest,
  createValueManifest,
  checkThemeConsistency,
};

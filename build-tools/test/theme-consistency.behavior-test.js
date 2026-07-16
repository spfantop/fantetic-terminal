const assert = require('node:assert/strict');
const path = require('node:path');

const {
  canonicalizeThemes,
  compareThemeCatalogs,
  compareThemeValues,
  createThemeManifest,
  createValueManifest,
} = require('../check-theme-consistency');

const theme = (name, background) => ({
  name,
  isPreset: true,
  themeData: {
    foreground: '#ffffff',
    background,
    cursor: '#ffffff',
    black: '#000000',
    red: '#ff0000',
  },
});

const backendThemes = [theme('Example Dark', '#101010')];
const frontendThemes = [theme('example_dark', '#101010')];

const backendCatalog = canonicalizeThemes(backendThemes, 'backend');
const frontendCatalog = canonicalizeThemes(frontendThemes, 'frontend');

assert.deepEqual(compareThemeCatalogs(backendCatalog, frontendCatalog), []);
assert.deepEqual(createThemeManifest(backendCatalog), {
  count: 1,
  hash: '86a13fa9ab3c009e8fa2968304fb68e60445c5ca9c8339889d509b0d56082f7a',
});

assert.deepEqual(createValueManifest({ beta: '#222222', alpha: '#111111' }), {
  count: 2,
  hash: 'df23ca001b3dcdd0cab8f60ebbfd4a283e190f0ad7c2cb1e7052a0110f815d7a',
});
assert.equal(compareThemeValues({ alpha: '#111111' }, { alpha: '#222222' }, '默认 xterm 主题'), '默认 xterm 主题不一致。');
assert.equal(compareThemeValues({ alpha: '#111111' }, { alpha: '#111111' }, '默认 xterm 主题'), null);

const changedFrontendCatalog = canonicalizeThemes([theme('Example Dark', '#202020')], 'frontend');
assert.deepEqual(compareThemeCatalogs(backendCatalog, changedFrontendCatalog), [
  '主题 Example Dark 的 themeData 不一致。',
]);

assert.throws(
  () => canonicalizeThemes([theme('Example Dark', '#101010'), theme('example_dark', '#101010')], 'frontend'),
  /重复主题键/,
);

const sourceRoot = path.resolve(__dirname, '../..');
assert.doesNotThrow(() => require('../check-theme-consistency').checkThemeConsistency(sourceRoot));

console.log('theme consistency behavior ok');

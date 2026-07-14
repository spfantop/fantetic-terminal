const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const localesDirectory = path.join(__dirname, '../../dist/locales');
const defaultLocalePath = path.join(localesDirectory, 'en-US.json');

assert.ok(fs.existsSync(localesDirectory), 'the packaged runtime must include dist/locales');
assert.ok(fs.existsSync(defaultLocalePath), 'the packaged runtime must include the default locale');

console.log('packaged backend locales behavior passed');

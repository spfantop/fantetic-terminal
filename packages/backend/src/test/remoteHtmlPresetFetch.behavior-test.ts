import assert from 'node:assert/strict';

import {
  fetchRemoteHtmlPreset,
  parseRemoteHtmlPresetUrl,
  REMOTE_HTML_PRESET_MAX_BYTES,
} from '../appearance/remote-html-preset-fetch';

const validUrl = 'https://raw.githubusercontent.com/acme/themes/main/terminal.html';
assert.equal(parseRemoteHtmlPresetUrl(validUrl).href, validUrl);

for (const invalidUrl of [
  'http://raw.githubusercontent.com/acme/themes/main/terminal.html',
  'https://127.0.0.1/internal.html',
  'https://localhost/internal.html',
  'https://user:password@raw.githubusercontent.com/acme/themes/main/terminal.html',
  'https://raw.githubusercontent.com:444/acme/themes/main/terminal.html',
  'https://raw.githubusercontent.com/acme/themes/main/terminal.txt',
]) {
  assert.throws(() => parseRemoteHtmlPresetUrl(invalidUrl), /GitHub.*HTML|URL/i, invalidUrl);
}

let requestCount = 0;
const content = await fetchRemoteHtmlPreset(validUrl, async (url, config) => {
  requestCount += 1;
  assert.equal(url, validUrl);
  assert.equal(config.responseType, 'text');
  assert.equal(config.maxRedirects, 0);
  assert.equal(config.maxContentLength, REMOTE_HTML_PRESET_MAX_BYTES);
  assert.equal(config.timeout, 10_000);
  return { status: 200, data: '<div>safe theme</div>' };
});
assert.equal(requestCount, 1);
assert.equal(content, '<div>safe theme</div>');

await assert.rejects(
  fetchRemoteHtmlPreset('http://127.0.0.1/private.html', async () => {
    requestCount += 1;
    return { status: 200, data: 'private' };
  }),
  /GitHub.*HTML|URL/i,
);
assert.equal(requestCount, 1, 'invalid targets must be rejected before any network request');

await assert.rejects(
  fetchRemoteHtmlPreset(validUrl, async () => ({
    status: 200,
    data: '界'.repeat(REMOTE_HTML_PRESET_MAX_BYTES),
  })),
  /不得超过/,
);

console.log('remote HTML preset fetch behavior passed');

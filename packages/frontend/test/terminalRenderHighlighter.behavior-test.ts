import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createTerminalRenderHighlighter,
  previewTerminalRenderHighlightSegments,
  type TerminalRenderHighlightOptions,
} from '../src/utils/terminalRenderHighlighter';
import { cloneDefaultTerminalHighlightRules } from '../src/utils/terminalOutputHighlighter';

const options: TerminalRenderHighlightOptions = {
  enabled: true,
  rules: [
    {
      id: 'error',
      name: 'error',
      enabled: true,
      pattern: 'ERROR',
      flags: 'g',
      foreground: '#ef4444',
      background: '#102030',
      bold: true,
      underline: true,
      priority: 1,
    },
  ],
};

const line = {
  length: 12,
  translateToString: (_trimRight: boolean, _start: number, _end: number, columns: number[]) => {
    columns.push(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);
    return 'INFO ERROR';
  },
};

const highlighter = createTerminalRenderHighlighter(() => options);
const decoration = highlighter.resolveLine(line);

assert.equal(decoration?.styles[0], undefined);
assert.equal(decoration?.styles[5]?.foreground, '#ef4444');
assert.equal(decoration?.styles[9]?.bold, true);
assert.equal(decoration?.styles[9]?.underline, true);

const cachedDecoration = highlighter.resolveLine(line);
assert.equal(cachedDecoration, decoration, 'unchanged lines should reuse the resolved style cache');

let wideText = `INFO ERROR ${'x'.repeat(90)}`;
let wideLineTranslations = 0;
let invalidateAttachedWideLine: () => void = () => undefined;
const wideRenderLine = {
  length: 4096,
  translateToString: (_trimRight: boolean, _start: number, _end: number, columns: number[]) => {
    wideLineTranslations += 1;
    columns.push(...Array.from({ length: wideText.length + 1 }, (_, index) => index));
    return wideText;
  },
  loadCell: (_column: number, cell: typeof sourceCell) => cell,
};
const wideRowFactory: { createRow: (...args: unknown[]) => unknown } = { createRow: () => undefined };
const wideTerminal = {
  onWriteParsed: (listener: () => void) => {
    invalidateAttachedWideLine = listener;
    return { dispose() {} };
  },
  onResize: () => ({ dispose() {} }),
  _core: {
    _renderService: { _renderer: { value: { _rowFactory: wideRowFactory } } },
    _bufferService: { buffer: { lines: { length: 1, get: (index: number) => index === 0 ? wideRenderLine : undefined } } },
  },
};
const attachedWideHighlighter = createTerminalRenderHighlighter(() => options);
assert.equal(attachedWideHighlighter.attach(wideTerminal as never), true);
wideRowFactory.createRow(wideRenderLine, 0);
const attachedWideDecoration = attachedWideHighlighter.resolveLine(wideRenderLine);
assert.equal(
  attachedWideDecoration?.styles.length,
  wideText.length,
  'single-line mode must not allocate a sparse style array for all 4096 terminal columns',
);
wideRowFactory.createRow(wideRenderLine, 0);
assert.equal(wideLineTranslations, 2, 'renderer cache hits must not translate an unchanged 4096-column line again');
const decorationBuildsBeforeWrite = attachedWideHighlighter.getStats().lineDecorationBuildCount;
invalidateAttachedWideLine();
wideRowFactory.createRow(wideRenderLine, 0);
assert.equal(wideLineTranslations, 3, 'parsed terminal writes must invalidate the renderer fast cache');
assert.equal(
  attachedWideHighlighter.getStats().lineDecorationBuildCount,
  decorationBuildsBeforeWrite,
  'parsed writes must not rebuild per-cell styles for unchanged rows',
);
wideText = `INFO READY ${'x'.repeat(90)}`;
invalidateAttachedWideLine();
wideRowFactory.createRow(wideRenderLine, 0);
assert.equal(
  attachedWideHighlighter.getStats().lineDecorationBuildCount,
  decorationBuildsBeforeWrite + 1,
  'a BufferLine mutated in place must rebuild its decoration exactly once',
);
assert.equal(
  attachedWideHighlighter.resolveLine(wideRenderLine),
  undefined,
  'a changed row must not retain stale highlight styles from the previous write',
);

let wrappedLineTranslations = 0;
const wrappedLineList = Array.from({ length: 64 }, (_, index) => ({
  length: 80,
  isWrapped: index > 0,
  translateToString: (_trimRight: boolean, _start: number, _end: number, columns?: number[]) => {
    wrappedLineTranslations += 1;
    columns?.push(...Array.from({ length: 81 }, (_, column) => column));
    return `${'x'.repeat(74)} ERROR`;
  },
  loadCell: (_column: number, cell: typeof sourceCell) => cell,
}));
const wrappedRowFactory: { createRow: (...args: unknown[]) => unknown } = { createRow: () => undefined };
const wrappedTerminal = {
  onWriteParsed: () => ({ dispose() {} }),
  onResize: () => ({ dispose() {} }),
  _core: {
    _renderService: { _renderer: { value: { _rowFactory: wrappedRowFactory } } },
    _bufferService: {
      buffer: {
        lines: { length: wrappedLineList.length, get: (index: number) => wrappedLineList[index] },
      },
    },
  },
};
const wrappedHighlighter = createTerminalRenderHighlighter(() => options);
assert.equal(wrappedHighlighter.attach(wrappedTerminal as never), true);
for (let row = 0; row < wrappedLineList.length; row += 1) {
  wrappedRowFactory.createRow(wrappedLineList[row], row);
}
assert.ok(
  wrappedLineTranslations <= wrappedLineList.length,
  `wrapped rows must reuse their logical-line text projection, received ${wrappedLineTranslations} translations`,
);

const equivalentLine = { ...line };
highlighter.resolveLine(equivalentLine);
assert.equal(
  highlighter.getStats().rangeResolutionCount,
  1,
  'resize/reflow lines with the same text must reuse semantic range resolution',
);

for (let index = 0; index < 1100; index += 1) {
  const text = `INFO ERROR ${index}`;
  highlighter.resolveLine({
    length: text.length,
    translateToString: () => text,
    getTrimmedLength: () => text.length,
    getWidth: () => 1,
    getString: (column: number) => text[column],
  });
}
assert.ok(highlighter.getStats().lineDecorationCacheSize <= 1024, 'scrolling must not retain unbounded per-cell style arrays');

const textCacheBoundHighlighter = createTerminalRenderHighlighter(() => ({
  enabled: true,
  rules: [{
    id: 'never-match',
    name: 'never match',
    enabled: true,
    pattern: 'NEVER_MATCH_THIS_TEXT',
    flags: 'g',
    foreground: '#FFFFFF',
  }],
}));
for (let index = 0; index < 1300; index += 1) {
  const text = `plain-${index}-${'x'.repeat(3390)}`;
  textCacheBoundHighlighter.resolveLine({
    length: 1,
    translateToString: (_trimRight: boolean, _start: number, _end: number, columns: number[]) => {
      columns.push(0, 1);
      return text;
    },
  });
}
assert.ok(
  textCacheBoundHighlighter.getStats().resolvedTextCacheCharacters <= 4 * 1024 * 1024,
  'long unmatched lines must not make the semantic text cache retain more than its character budget',
);

const legacyText = 'INFO ERROR';
const legacyLine = {
  length: legacyText.length,
  translateToString: () => legacyText,
  getTrimmedLength: () => legacyText.length,
  getWidth: () => 1,
  getString: (column: number) => legacyText[column],
};
assert.equal(
  highlighter.resolveLine(legacyLine)?.styles[5]?.foreground,
  '#ef4444',
  'xterm 5.3 buffer lines without translateToString(outColumns) must map ranges back to cells',
);

const defaultSemanticRules = cloneDefaultTerminalHighlightRules();
const assertDefaultWholeLineHighlight = (
  text: string,
  foreground: string,
  bold: boolean,
  message: string,
) => {
  assert.deepEqual(
    previewTerminalRenderHighlightSegments(text, {
      enabled: true,
      rules: defaultSemanticRules,
    }),
    [{
      text,
      foreground,
      background: undefined,
      bold,
      underline: false,
    }],
    message,
  );
};
const semanticPreview = previewTerminalRenderHighlightSegments('{"code":200,"ok":true}', {
  enabled: true,
  rules: defaultSemanticRules,
});
assert.equal(semanticPreview[0].foreground, '#C678DD', 'settings preview must use the terminal boundary rule');
assert.ok(semanticPreview.some(segment => segment.text === '"code"' && segment.foreground === '#61AFEF'));
assert.ok(semanticPreview.some(segment => segment.text === '200' && segment.foreground === '#D19A66'));
assert.ok(semanticPreview.some(segment => segment.text === 'true' && segment.foreground === '#C678DD'));
const prefixedJsonPreview = previewTerminalRenderHighlightSegments(
  '2026-09-02 11:26:00.341 [scheduling-1] INFO [ThirdPartyFeignLogger.java:46] - '
    + '[ThirdPartyFeign] [Client#read] {"errCode":0,"success":true}',
  { enabled: true, rules: defaultSemanticRules },
);
assert.equal(
  prefixedJsonPreview.find(segment => segment.text === '2026-09-02 11:26:00.341')?.foreground,
  '#7A8599',
  'JSON log lines must preserve the normal timestamp style in their prefix',
);
assert.equal(
  prefixedJsonPreview.some(segment => segment.text === '11:26:00' && segment.foreground === '#A78BFA'),
  false,
  'time components before a JSON payload must not be misclassified as IPv6 addresses',
);
const errorCodePreview = previewTerminalRenderHighlightSegments(
  '{"errCode":500,"status":503,"status":200,"success":false,"errMsg":"系统异常，请联系管理员","errCode":0}',
  { enabled: true, rules: defaultSemanticRules },
);
const errorCodeSegments = errorCodePreview.filter(segment => segment.text === '500' || segment.text === '503');
assert.equal(errorCodeSegments.length, 2);
assert.ok(
  errorCodeSegments.every(segment => segment.foreground === '#F44747' && segment.bold === true),
  'error-code and status fields must render failing HTTP-style values as critical',
);
assert.equal(
  errorCodePreview.find(segment => segment.text === '200')?.foreground,
  '#D19A66',
  'successful status values must retain the normal JSON number style',
);
assert.equal(
  errorCodePreview.find(segment => segment.text === '0')?.foreground,
  '#D19A66',
  'zero-valued error codes must retain the normal JSON number style',
);
assert.deepEqual(
  errorCodePreview.find(segment => segment.text === 'false'),
  {
    text: 'false',
    foreground: '#F44747',
    background: undefined,
    bold: true,
    underline: false,
  },
  'success=false must use the same critical style as a failing error code',
);
assert.deepEqual(
  errorCodePreview.find(segment => segment.text === '"系统异常，请联系管理员"'),
  {
    text: '"系统异常，请联系管理员"',
    foreground: '#F44747',
    background: undefined,
    bold: true,
    underline: false,
  },
  'error messages in a failed JSON response must use the critical style',
);
const customizedErrorRules = defaultSemanticRules.map((rule) => {
  if (rule.id === 'preset-error') return { ...rule, foreground: '#E5484D' };
  if (rule.id === 'preset-http-status-error') return { ...rule, foreground: '#FFB224' };
  return rule;
});
const customizedErrorPreview = previewTerminalRenderHighlightSegments(
  '{"errCode":500,"success":false,"errMsg":"失败"}',
  { enabled: true, rules: customizedErrorRules },
);
for (const text of ['500', 'false', '"失败"']) {
  assert.equal(
    customizedErrorPreview.find(segment => segment.text === text)?.foreground,
    '#E5484D',
    `JSON business failure token ${text} must use the general ERROR semantic style`,
  );
}
const successMessagePreview = previewTerminalRenderHighlightSegments(
  '{"errCode":0,"success":true,"errMsg":"操作成功"}',
  { enabled: true, rules: defaultSemanticRules },
);
assert.equal(successMessagePreview.find(segment => segment.text === 'true')?.foreground, '#C678DD');
assert.equal(successMessagePreview.find(segment => segment.text === '"操作成功"')?.foreground, '#98C379');
const denseErrorCodePreview = previewTerminalRenderHighlightSegments(
  `{${Array.from({ length: 80 }, (_, index) => `"field${index}":${index}`).join(',')},"errCode":500}`,
  { enabled: true, rules: defaultSemanticRules },
);
assert.equal(
  denseErrorCodePreview.find(segment => segment.text === '500')?.foreground,
  '#F44747',
  'critical error codes must survive the dense JSON primitive budget',
);
const headerPreview = previewTerminalRenderHighlightSegments('headers=[Server:"gunicorn", Date:"Fri"]', {
  enabled: true,
  rules: defaultSemanticRules,
});
assert.equal(
  headerPreview.find(segment => segment.text.includes('gunicorn'))?.foreground,
  undefined,
  'quoted values in non-JSON log metadata must remain neutral',
);
const sensitiveHeaderPreview = previewTerminalRenderHighlightSegments(
  '=====Headers==== access_token: Bearer eyJhbGciOiJIUzI1NiJ9.172.16.0.1.deadbeef',
  { enabled: true, rules: defaultSemanticRules },
);
assert.equal(
  sensitiveHeaderPreview.some(segment => segment.foreground || segment.background || segment.bold || segment.underline),
  false,
  'sensitive request-header values must stay visually neutral instead of matching generic token rules',
);
const refererHeaderPreview = previewTerminalRenderHighlightSegments(
  '=====Headers==== referer: http://localhost:5173/authorization/manage',
  { enabled: true, rules: defaultSemanticRules },
);
assert.ok(
  refererHeaderPreview.some(segment => segment.text.includes('http://localhost:5173') && segment.foreground),
  'URL-valued request headers should retain useful scoped highlighting',
);
const feignRequestUrl = 'http://172.16.0.109:6656/zhengqi-openapi/openapi/invoice-delivery/listByRequestId';
const feignRequestPreview = previewTerminalRenderHighlightSegments(
  `[ThirdPartyFeign] ---> POST ${feignRequestUrl} HTTP/1.1`,
  { enabled: true, rules: defaultSemanticRules },
);
assert.deepEqual(
  feignRequestPreview.find(segment => segment.text.includes('listByRequestId')),
  {
    text: feignRequestUrl,
    foreground: '#61AFEF',
    background: undefined,
    bold: false,
    underline: true,
  },
  'HTTP URLs must not be split or overridden by shell prompt-path highlighting',
);
for (const feignHeaderLine of [
  '[ThirdPartyFeign] [Client#read] date: Wed, 02 Sep 2026 01:23:00 GMT',
  '[ThirdPartyFeign] [Client#read] keep-alive: timeout=60',
  '[ThirdPartyFeign] [Client#read] content-type: application/json;charset=UTF-8',
]) {
  assert.equal(
    previewTerminalRenderHighlightSegments(feignHeaderLine, {
      enabled: true,
      rules: defaultSemanticRules,
    }).some(segment => segment.foreground || segment.background || segment.bold || segment.underline),
    false,
    `Feign metadata headers must stay visually neutral: ${feignHeaderLine}`,
  );
}
const prefixedFeignHeaderPreview = previewTerminalRenderHighlightSegments(
  '2026-09-02 11:26:00.341 [scheduling-1] INFO [ThirdPartyFeignLogger.java:46] - '
    + '[ThirdPartyFeign] [Client#read] content-type: application/json;charset=UTF-8',
  { enabled: true, rules: defaultSemanticRules },
);
assert.equal(
  prefixedFeignHeaderPreview.find(segment => segment.text === '2026-09-02 11:26:00.341')?.foreground,
  '#7A8599',
  'Feign metadata lines must preserve the normal timestamp style in their log prefix',
);
assert.equal(
  prefixedFeignHeaderPreview.find(segment => segment.text === '[scheduling-1]')?.foreground,
  '#98C379',
  'Feign metadata lines must preserve the normal thread style in their log prefix',
);
assert.equal(
  prefixedFeignHeaderPreview.find(segment => segment.text === 'INFO')?.foreground,
  '#8BE9FD',
  'Feign metadata lines must preserve the normal log-level style in their prefix',
);
assert.equal(
  prefixedFeignHeaderPreview.find(segment => segment.text === 'ThirdPartyFeignLogger.java:46')?.foreground,
  '#DCDCAA',
  'Feign metadata lines must preserve the normal source-location style in their prefix',
);
assert.equal(
  prefixedFeignHeaderPreview.some(segment => (
    segment.text.includes('application/json')
    && (segment.foreground || segment.background || segment.bold || segment.underline)
  )),
  false,
  'Feign metadata values must remain neutral after restoring prefix highlighting',
);
const feignHostHeaderPreview = previewTerminalRenderHighlightSegments(
  '[ThirdPartyFeign] [Client#read] host: 172.16.0.109:6656',
  { enabled: true, rules: defaultSemanticRules },
);
assert.ok(
  feignHostHeaderPreview.some(segment => segment.text === '172.16.0.109:6656' && segment.foreground),
  'Feign host headers should retain scoped network-address highlighting',
);
const multipleJsonPreview = previewTerminalRenderHighlightSegments('headers=[], body={"account":1}', {
  enabled: true,
  rules: defaultSemanticRules,
});
assert.ok(
  multipleJsonPreview.some(segment => segment.text === '"account"' && segment.foreground === '#61AFEF'),
  'body JSON must be parsed independently after an earlier JSON-like structure',
);
assert.ok(
  multipleJsonPreview.some(segment => segment.text === '{' && segment.foreground === '#C678DD'),
  'body JSON must receive its own outer boundary style',
);
const crowdedPrefix = `[${Array.from({ length: 260 }, (_, index) => index).join(',')}] body={"account":1}`;
assert.ok(
  previewTerminalRenderHighlightSegments(crowdedPrefix, { enabled: true, rules: defaultSemanticRules })
    .some(segment => segment.text === '"account"' && segment.foreground === '#61AFEF'),
  'an earlier dense structure must not exhaust the body JSON token budget',
);

const disabledKeyRules = defaultSemanticRules.map(rule => rule.id === 'preset-json-key' ? { ...rule, enabled: false } : rule);
assert.equal(
  previewTerminalRenderHighlightSegments('{"code":200}', { enabled: true, rules: disabledKeyRules })
    .find(segment => segment.text === '"code"')?.foreground,
  undefined,
  'disabling a JSON setting rule must disable the same style in preview and terminal',
);

const disabledHighlighter = createTerminalRenderHighlighter(() => ({ ...options, enabled: false }));
assert.equal(disabledHighlighter.resolveLine(line), undefined);

const terminalManagerSource = readFileSync(
  resolve(import.meta.dirname, '..', 'packages/frontend/src/composables/useSshTerminal.ts'),
  'utf8',
);
assert.match(
  terminalManagerSource,
  /if \(!terminalHighlightEnabledBoolean\.value \|\| terminalHighlightRulesList\.value\.length === 0\)[\s\S]{0,160}terminalRenderHighlighter\.dispose\(\)/,
  'disabled highlighting must detach the xterm row renderer hook',
);
assert.match(
  terminalManagerSource,
  /syncTerminalRenderHighlighter\(term\)/,
  'terminal readiness and renderer replacement must share highlighter lifecycle synchronization',
);
assert.match(
  terminalManagerSource,
  /resolveTerminalHighlightRulesForTheme\([\s\S]{0,180}effectiveTerminalHighlightBackground\.value/,
  'the live renderer must resolve preset colors against the active terminal background',
);
assert.match(
  terminalManagerSource,
  /watch\([\s\S]{0,180}effectiveTerminalHighlightBackground/,
  'changing the terminal theme must invalidate and refresh semantic highlighting',
);

const terminalHighlightSettingsSource = readFileSync(
  resolve(import.meta.dirname, '..', 'packages/frontend/src/composables/settings/useTerminalHighlightSettings.ts'),
  'utf8',
);
assert.match(
  terminalHighlightSettingsSource,
  /terminalHighlightPreviewMode[\s\S]*darkXtermTheme[\s\S]*lightXtermTheme/,
  'settings must support current, dark, and light terminal preview backgrounds',
);
assert.match(
  terminalHighlightSettingsSource,
  /resolveTerminalHighlightRulesForTheme\([\s\S]{0,180}terminalHighlightPreviewBackground/,
  'settings preview must use the same theme-aware palette as the live terminal',
);

const terminalHighlightSettingsComponentSource = readFileSync(
  resolve(import.meta.dirname, '..', 'packages/frontend/src/components/settings/TerminalHighlightSettings.vue'),
  'utf8',
);
assert.match(
  terminalHighlightSettingsComponentSource,
  /:style="terminalHighlightPreviewStyle"/,
  'the preview surface must render on the selected terminal theme rather than the UI panel background',
);

const densePresetHighlighter = createTerminalRenderHighlighter(() => ({
  enabled: true,
  rules: [{
    id: 'preset-number',
    name: 'number',
    enabled: true,
    pattern: '\\b\\d+\\b',
    flags: 'g',
    foreground: '#B5CEA8',
  }],
}));
assert.equal(
  densePresetHighlighter.resolveLine({
    length: 10,
    translateToString: (_trimRight: boolean, _start: number, _end: number, columns: number[]) => {
      columns.push(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
      return '123 456789';
    },
  }),
  undefined,
  'dense fallback presets must not create unbounded DOM span fragmentation',
);

const jsonHighlighter = createTerminalRenderHighlighter(() => ({
  enabled: true,
  rules: [{
    id: 'preset-json-inline-object',
    name: 'json',
    enabled: true,
    pattern: '\\{.*\\}',
    flags: 'g',
    foreground: '#C586C0',
    bold: true,
  }],
}));
const jsonText = 'INFO body={"account":1855,"ok":true} cost=12ms';
const jsonColumns = Array.from({ length: jsonText.length + 1 }, (_, index) => index);
const jsonDecoration = jsonHighlighter.resolveLine({
  length: jsonText.length,
  translateToString: (_trimRight: boolean, _start: number, _end: number, columns: number[]) => {
    columns.push(...jsonColumns);
    return jsonText;
  },
});
assert.equal(jsonDecoration?.styles[10]?.foreground, '#C586C0', 'outer JSON braces must be visually prominent');
assert.equal(jsonDecoration?.styles[10]?.bold, true, 'outer JSON braces must be bold');
assert.equal(jsonDecoration?.styles[11]?.foreground, '#9CDCFE', 'JSON keys must use their semantic colour');
assert.equal(jsonDecoration?.styles[21]?.foreground, '#B5CEA8', 'JSON numbers must use their semantic colour');
assert.equal(jsonDecoration?.styles[31]?.foreground, '#569CD6', 'JSON literals must use their semantic colour');
assert.equal(jsonDecoration?.styles[40], undefined, 'JSON range must stop before following log fields');

const longJsonText = `===Result=== {${Array.from(
  { length: 80 },
  (_, index) => `"field${index}":${index % 2 === 0 ? `"value${index}"` : index}`,
).join(',')}}`;
const longJsonPreview = previewTerminalRenderHighlightSegments(longJsonText, {
  enabled: true,
  rules: defaultSemanticRules,
});
const longJsonStyledSegments = longJsonPreview.filter(
  segment => segment.foreground || segment.background || segment.bold || segment.underline,
);
assert.ok(
  longJsonStyledSegments.length <= 100,
  `long JSON must use a bounded low-fragmentation palette, received ${longJsonStyledSegments.length} styled segments`,
);
assert.equal(
  longJsonPreview.find(segment => segment.text.includes('"value0"'))?.foreground,
  undefined,
  'long JSON string values should remain neutral so keys and primitive values keep visual priority',
);
assert.equal(
  longJsonPreview.filter(segment => segment.text.includes(',')).some(segment => segment.foreground),
  false,
  'long JSON punctuation should remain neutral to reduce renderer span fragmentation',
);
const denseJsonWithSqlLikeString = `{"query":"SELECT UPDATE FROM records",${Array.from(
  { length: 80 },
  (_, index) => `"field${index}":"value${index}"`,
).join(',')}}`;
assert.equal(
  previewTerminalRenderHighlightSegments(denseJsonWithSqlLikeString, {
    enabled: true,
    rules: defaultSemanticRules,
  }).find(segment => segment.text === 'SELECT')?.foreground,
  undefined,
  'dense JSON string values must not be fragmented by unrelated SQL or shell presets',
);
const denseJsonWithRelevantSignals = `{"endpoint":"https://api.example.com/v1","status":"ERROR",${Array.from(
  { length: 80 },
  (_, index) => `"field${index}":"value${index}"`,
).join(',')}}`;
const denseJsonRelevantSignalPreview = previewTerminalRenderHighlightSegments(denseJsonWithRelevantSignals, {
  enabled: true,
  rules: defaultSemanticRules,
});
assert.ok(
  denseJsonRelevantSignalPreview.find(segment => segment.text.startsWith('https://api.example.com/v1'))?.foreground,
  'JSON rule routing must retain URL highlighting',
);
assert.ok(
  denseJsonRelevantSignalPreview.find(segment => segment.text === 'ERROR')?.foreground,
  'JSON rule routing must retain operational error highlighting',
);
const customJsonRule = {
  id: 'custom-tenant-code',
  name: 'tenant code',
  enabled: true,
  pattern: 'tenant_[a-z]+',
  flags: 'g',
  foreground: '#FF00FF',
};
assert.equal(
  previewTerminalRenderHighlightSegments(`${denseJsonWithRelevantSignals.slice(0, -1)},"tenant":"tenant_alpha"}`, {
    enabled: true,
    rules: [...defaultSemanticRules, customJsonRule],
  }).find(segment => segment.text === 'tenant_alpha')?.foreground,
  '#FF00FF',
  'JSON rule routing must always retain user-defined rules',
);
assert.ok(
  longJsonPreview.find(segment => segment.text === '"field79"')?.foreground,
  'long JSON key highlighting must remain consistent through the end of the payload',
);

const veryLongJsonText = `===Result=== {${Array.from(
  { length: 220 },
  (_, index) => `"option${index}":${index}`,
).join(',')}}`;
const veryLongJsonPreview = previewTerminalRenderHighlightSegments(veryLongJsonText, {
  enabled: true,
  rules: defaultSemanticRules,
});
assert.ok(
  veryLongJsonPreview.find(segment => segment.text === '"option219"')?.foreground,
  'dense JSON must not stop highlighting keys after the logical-line range budget is exhausted',
);
const oversizedJsonText = `===Result=== {${Array.from(
  { length: 760 },
  (_, index) => `"oversizedField${index}":"value${index}"`,
).join(',')},"oversizedTail":500}`;
assert.ok(oversizedJsonText.length > 16_384, 'oversized JSON fixture must cross the previous scan cutoff');
const oversizedJsonPreview = previewTerminalRenderHighlightSegments(oversizedJsonText, {
  enabled: true,
  rules: defaultSemanticRules,
});
assert.equal(
  oversizedJsonPreview.find(segment => segment.text === '"oversizedTail"')?.foreground,
  '#61AFEF',
  'JSON keys after the first 16KB scan window must remain highlighted',
);
assert.ok(
  oversizedJsonPreview.filter(segment => segment.foreground).length <= 4096,
  'oversized JSON highlighting must remain bounded by the global range budget',
);
const veryLongJsonTail = veryLongJsonText.slice(-180);
const veryLongJsonTailColumns = Array.from({ length: veryLongJsonTail.length + 1 }, (_, index) => index);
const veryLongJsonTailDecoration = jsonHighlighter.resolveLine({
  length: veryLongJsonTail.length,
  translateToString: (_trimRight: boolean, _start: number, _end: number, columns: number[]) => {
    columns.push(...veryLongJsonTailColumns);
    return veryLongJsonTail;
  },
}, {
  text: veryLongJsonText,
  rowTextOffset: veryLongJsonText.length - veryLongJsonTail.length,
});
assert.ok(
  veryLongJsonTailDecoration?.styles.some(style => style?.foreground === '#9CDCFE'),
  'the final visual row of dense JSON must retain key highlighting',
);
let veryLongJsonTailStyleRuns = 0;
let previousTailStyle = veryLongJsonTailDecoration?.styles[0];
for (const style of veryLongJsonTailDecoration?.styles.slice(1) ?? []) {
  if (style !== previousTailStyle) {
    if (style) veryLongJsonTailStyleRuns += 1;
    previousTailStyle = style;
  }
}
assert.ok(
  veryLongJsonTailStyleRuns <= 24,
  `a dense JSON visual row must remain low-fragmentation, received ${veryLongJsonTailStyleRuns} style runs`,
);

const wrappedJsonText = '  "account":1855,"ok":true';
const wrappedColumns = Array.from({ length: wrappedJsonText.length + 1 }, (_, index) => index);
assert.equal(
  jsonHighlighter.resolveLine({
    length: wrappedJsonText.length,
    translateToString: (_trimRight: boolean, _start: number, _end: number, columns: number[]) => {
      columns.push(...wrappedColumns);
      return wrappedJsonText;
    },
  })?.styles[3]?.foreground,
  '#9CDCFE',
  'a visual row produced by wrapping or resize must not require balanced braces',
);

const splitJsonHead = 'body={"message';
const splitJsonTail = 'Id":"abc","ok":true}';
const splitTailColumns = Array.from({ length: splitJsonTail.length + 1 }, (_, index) => index);
assert.equal(
  jsonHighlighter.resolveLine({
    length: splitJsonTail.length,
    translateToString: (_trimRight: boolean, _start: number, _end: number, columns: number[]) => {
      columns.push(...splitTailColumns);
      return splitJsonTail;
    },
  }, {
    text: splitJsonHead + splitJsonTail,
    rowTextOffset: splitJsonHead.length,
  })?.styles[0]?.foreground,
  '#9CDCFE',
  'JSON keys split across xterm visual rows must be resolved from the complete logical line',
);

const javaLogText = '2026-07-10 23:49:03 [RocketmqMessageConsumption-1-59] INFO [Client.java:76]';
const javaLogColumns = Array.from({ length: javaLogText.length + 1 }, (_, index) => index);
assert.equal(
  jsonHighlighter.resolveLine({
    length: javaLogText.length,
    translateToString: (_trimRight: boolean, _start: number, _end: number, columns: number[]) => {
      columns.push(...javaLogColumns);
      return javaLogText;
    },
  }),
  undefined,
  'ordinary Java thread/source brackets must never be classified as JSON arrays',
);

const cglibStackFrame = '    at org.springframework.aop.framework.CglibAopProxy$CglibMethodInvocation.invokeJoinpoint(CglibAopProxy.java:793)';
assertDefaultWholeLineHighlight(
  cglibStackFrame,
  '#C586C0',
  false,
  'Java inner-class stack frames must keep one consistent stack-trace style',
);

const modularStackFrame = '    at java.base/jdk.internal.reflect.NativeMethodAccessorImpl.invoke(NativeMethodAccessorImpl.java:77)';
assertDefaultWholeLineHighlight(
  modularStackFrame,
  '#C586C0',
  false,
  'Java module-prefixed stack frames must keep one consistent stack-trace style',
);

const keywordMethodStackFrame = '    at com.example.Worker.error(Worker.java:42)';
assertDefaultWholeLineHighlight(
  keywordMethodStackFrame,
  '#C586C0',
  false,
  'Java stack-frame structure must take precedence over generic keyword matches',
);

const versionedModuleStackFrame = '    at app/java.base@21.0.2/jdk.internal.reflect.NativeMethodAccessorImpl.invoke(NativeMethodAccessorImpl.java:77)';
assertDefaultWholeLineHighlight(
  versionedModuleStackFrame,
  '#C586C0',
  false,
  'Java class-loader and versioned-module stack frames must keep one stack-trace style',
);

const classLoaderStackFrame = '    at app//com.example.Worker.run(Worker.java:18)';
assertDefaultWholeLineHighlight(
  classLoaderStackFrame,
  '#C586C0',
  false,
  'Java class-loader-only stack frames must keep one consistent stack-trace style',
);

const constructorStackFrame = '    at com.example.Worker.<init>(Worker.java:12)';
assertDefaultWholeLineHighlight(
  constructorStackFrame,
  '#C586C0',
  false,
  'Java constructor stack frames must keep one consistent stack-trace style',
);

const causedByLine = 'Caused by: java.net.ConnectException: Connection refused';
assertDefaultWholeLineHighlight(
  causedByLine,
  '#FF8080',
  true,
  'Java cause-chain lines must keep their dedicated whole-line style',
);

const suppressedLine = '    Suppressed: java.io.IOException: close failed';
assertDefaultWholeLineHighlight(
  suppressedLine,
  '#FF8080',
  true,
  'Java suppressed-exception lines must keep the cause-chain style',
);

const collapsedStackFramesLine = '    ... 7 more';
assertDefaultWholeLineHighlight(
  collapsedStackFramesLine,
  '#C586C0',
  false,
  'Java collapsed stack-frame counts must keep the stack-trace style',
);

const omittedStackFramesLine = '    ... 4 common frames omitted';
assertDefaultWholeLineHighlight(
  omittedStackFramesLine,
  '#C586C0',
  false,
  'Java common-frame omission lines must keep the stack-trace style',
);

const shellVariablePreview = previewTerminalRenderHighlightSegments('echo $HOME', {
  enabled: true,
  rules: defaultSemanticRules,
});
assert.equal(
  shellVariablePreview.find(segment => segment.text === '$HOME')?.foreground,
  '#40C8AE',
  'Java stack-trace precedence must not disable shell-variable highlighting',
);

const nonStackAtLinePreview = previewTerminalRenderHighlightSegments('at /tmp/report.log', {
  enabled: true,
  rules: defaultSemanticRules,
});
assert.equal(
  nonStackAtLinePreview.some(segment => segment.foreground === '#C586C0'),
  false,
  'non-Java lines beginning with at must not receive the stack-trace style',
);

const sourceCell = {
  fg: 0,
  bg: 0,
  extended: {
    underlineStyle: 0,
    clone() {
      return { ...this };
    },
  },
};

const zoomSensitiveJsonText = `{${Array.from(
  { length: 260 },
  (_, index) => `"field${String(index).padStart(3, '0')}":"value${String(index).padStart(3, '0')}"`,
).join(',')},"zoomTail":500}`;
const renderJsonTailAtWidth = (cols: number): number => {
  const lineList = Array.from(
    { length: Math.ceil(zoomSensitiveJsonText.length / cols) },
    (_, row) => {
      const text = zoomSensitiveJsonText.slice(row * cols, (row + 1) * cols);
      return {
        length: text.length,
        isWrapped: row > 0,
        translateToString: (_trimRight: boolean, _start: number, _end: number, columns: number[]) => {
          columns.push(...Array.from({ length: text.length + 1 }, (_, column) => column));
          return text;
        },
        loadCell: (_column: number, target: typeof sourceCell) => {
          target.fg = 0;
          target.bg = 0;
          target.extended = sourceCell.extended;
          return target;
        },
      };
    },
  );
  const tailOffset = zoomSensitiveJsonText.indexOf('"zoomTail"');
  const tailRow = Math.floor(tailOffset / cols);
  const tailColumn = tailOffset % cols;
  const zoomRowFactory = {
    createRow(renderedLine: (typeof lineList)[number], _row?: number) {
      const cell = { fg: 0, bg: 0, extended: sourceCell.extended };
      renderedLine.loadCell(tailColumn, cell);
      return cell;
    },
  };
  const zoomTerminal = {
    onWriteParsed: () => ({ dispose() {} }),
    onResize: () => ({ dispose() {} }),
    _core: {
      _renderService: { _renderer: { value: { _rowFactory: zoomRowFactory } } },
      _bufferService: {
        buffer: { lines: { length: lineList.length, get: (row: number) => lineList[row] } },
      },
    },
  };
  const zoomHighlighter = createTerminalRenderHighlighter(() => ({
    enabled: true,
    rules: defaultSemanticRules,
  }));
  assert.equal(zoomHighlighter.attach(zoomTerminal as never), true);
  const color = zoomRowFactory.createRow(lineList[tailRow], tailRow).fg & 0x00ffffff;
  zoomHighlighter.dispose();
  return color;
};

assert.equal(renderJsonTailAtWidth(112), 0x61afef, 'JSON tail keys must be highlighted below 64 visual rows');
assert.equal(
  renderJsonTailAtWidth(80),
  0x61afef,
  'JSON tail keys must remain highlighted when 100% zoom wraps the same payload beyond 64 visual rows',
);

const renderLine = {
  length: 12,
  translateToString: line.translateToString,
  loadCell: (_column: number, target: typeof sourceCell) => {
    target.fg = sourceCell.fg;
    target.bg = sourceCell.bg;
    target.extended = sourceCell.extended;
    return target;
  },
};
const rowFactory = {
  createRow(renderedLine: typeof renderLine) {
    const cell = {
      fg: 0,
      bg: 0,
      extended: sourceCell.extended,
    };
    renderedLine.loadCell(5, cell);
    return cell;
  },
};
const terminal = {
  _core: {
    _renderService: {
      _renderer: { value: { _rowFactory: rowFactory } },
    },
  },
};

assert.equal(highlighter.attach(terminal as never), true);
const renderedCell = rowFactory.createRow(renderLine);
assert.equal(renderedCell.fg & 0x00ffffff, 0xef4444, 'renderer should receive the highlight RGB value');
assert.equal(renderedCell.bg & 0x00ffffff, 0x102030, 'renderer should receive the highlight background value');
assert.equal(renderedCell.fg & 0x08000000, 0x08000000, 'renderer should receive bold without changing the buffer cell');
assert.equal(renderedCell.fg & 0x10000000, 0x10000000, 'renderer should receive underline without changing the buffer cell');
assert.equal(sourceCell.fg, 0, 'the underlying terminal cell must remain untouched');
sourceCell.fg = 0x01000001;
assert.equal(rowFactory.createRow(renderLine).fg, 0x01000001, 'remote ANSI colors must take precedence over local highlighting');
sourceCell.fg = 0;
const replacementRowFactory = {
  createRow(renderedLine: typeof renderLine) {
    const cell = { fg: 0, bg: 0, extended: sourceCell.extended };
    renderedLine.loadCell(5, cell);
    return cell;
  },
};
terminal._core._renderService._renderer.value._rowFactory = replacementRowFactory;
const resolutionsBeforeRendererReplacement = highlighter.getStats().rangeResolutionCount;
assert.equal(highlighter.ensureAttached(terminal as never), true, 'renderer replacement must be detected and patched');
assert.equal(
  replacementRowFactory.createRow(renderLine).fg & 0x00ffffff,
  0xef4444,
  'highlighting must survive xterm renderer replacement after resize',
);
assert.equal(
  highlighter.getStats().rangeResolutionCount,
  resolutionsBeforeRendererReplacement,
  'renderer replacement must preserve semantic text caches',
);
highlighter.dispose();
assert.equal(rowFactory.createRow(renderLine).fg, 0, 'disposing should restore the original xterm row factory');

console.log('terminal render highlighter behavior tests passed');

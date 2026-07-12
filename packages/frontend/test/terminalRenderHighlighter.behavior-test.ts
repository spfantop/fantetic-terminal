import { strict as assert } from 'node:assert';
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
const semanticPreview = previewTerminalRenderHighlightSegments('{"code":200,"ok":true}', {
  enabled: true,
  rules: defaultSemanticRules,
});
assert.equal(semanticPreview[0].foreground, '#C678DD', 'settings preview must use the terminal boundary rule');
assert.ok(semanticPreview.some(segment => segment.text === '"code"' && segment.foreground === '#61AFEF'));
assert.ok(semanticPreview.some(segment => segment.text === '200' && segment.foreground === '#D19A66'));
assert.ok(semanticPreview.some(segment => segment.text === 'true' && segment.foreground === '#C678DD'));
const headerPreview = previewTerminalRenderHighlightSegments('headers=[Server:"gunicorn", Date:"Fri"]', {
  enabled: true,
  rules: defaultSemanticRules,
});
assert.equal(
  headerPreview.find(segment => segment.text.includes('gunicorn'))?.foreground,
  undefined,
  'quoted values in non-JSON log metadata must remain neutral',
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

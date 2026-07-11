import type { Terminal } from '@xterm/xterm';
import {
  createTerminalHighlightRangeResolver,
  type TerminalHighlightOptions,
  type TerminalHighlightPreviewSegment,
  type TerminalHighlightRange,
  type TerminalHighlightRule,
} from './terminalOutputHighlighter';

const XTERM_COLOR_MODE_MASK = 0x03000000;
const XTERM_RGB_COLOR_MODE = 0x03000000;
const XTERM_RGB_MASK = 0x00ffffff;
const XTERM_BOLD_FLAG = 0x08000000;
const XTERM_UNDERLINE_FLAG = 0x10000000;
const XTERM_HAS_EXTENDED_ATTRS_FLAG = 0x10000000;
const XTERM_SINGLE_UNDERLINE = 1;
// These broad presets create hundreds of style boundaries per viewport and
// make xterm's DOM renderer allocate an excessive number of spans. More
// specific rules still color timestamps, durations, status codes, IDs, quoted
// strings and log levels, so semantic highlighting remains intact.
const DENSE_RENDER_PRESET_IDS = new Set([
  'preset-number',
  'preset-hash',
  'preset-json-inline-object',
  'preset-json-inline-array',
  'preset-json-pretty-key-value-line',
  'preset-json-pretty-bracket-line',
  'preset-json-boundary',
  'preset-json-key',
  'preset-json-string',
  'preset-json-number',
  'preset-json-literal',
  'preset-json-punctuation',
]);

export interface TerminalRenderHighlightOptions extends TerminalHighlightOptions {
  rules: TerminalHighlightRule[];
}

interface XtermExtendedAttrs {
  underlineStyle: number;
  clone(): XtermExtendedAttrs;
}

interface XtermCellData {
  fg: number;
  bg: number;
  extended: XtermExtendedAttrs;
}

interface XtermBufferLine {
  length: number;
  isWrapped?: boolean;
  translateToString(trimRight?: boolean, startCol?: number, endCol?: number, outColumns?: number[]): string;
  loadCell(index: number, cell: XtermCellData): XtermCellData;
  getTrimmedLength?: () => number;
  getWidth?: (index: number) => number;
  getString?: (index: number) => string;
}

interface XtermRowFactory {
  createRow: (...args: unknown[]) => unknown;
}

interface XtermRenderService {
  _renderer?: {
    value?: {
      _rowFactory?: XtermRowFactory;
    };
    _rowFactory?: XtermRowFactory;
  };
}

interface XtermTerminalInternals {
  _core?: {
    _renderService?: XtermRenderService;
    _bufferService?: {
      buffer?: {
        lines?: {
          get(index: number): XtermBufferLine | undefined;
          length?: number;
        };
      };
    };
  };
}

interface LogicalLineContext {
  text: string;
  rowTextOffset: number;
}

export interface TerminalRenderLineDecoration {
  styles: Array<ResolvedCellStyle | undefined>;
}

interface ResolvedCellStyle extends TerminalHighlightRange {
  foregroundRgb?: number;
  backgroundRgb?: number;
}

interface JsonHighlightStyles {
  enabled: boolean;
  key: Partial<TerminalHighlightRange>;
  string: Partial<TerminalHighlightRange>;
  number: Partial<TerminalHighlightRange>;
  literal: Partial<TerminalHighlightRange>;
  boundary: Partial<TerminalHighlightRange>;
  punctuation: Partial<TerminalHighlightRange>;
}

interface CachedLineDecoration extends TerminalRenderLineDecoration {
  text: string;
  logicalText?: string;
  rowTextOffset: number;
  rules: TerminalHighlightRule[];
  enabled: boolean;
  hasStyles: boolean;
}

/**
 * Supplies highlight attributes only while xterm builds a DOM row. No buffer
 * cells, terminal bytes or generated DOM are mutated, which keeps cursor,
 * reflow and scrollback ownership entirely inside xterm.
 */
export function createTerminalRenderHighlighter(getOptions: () => TerminalRenderHighlightOptions) {
  // BufferLine objects naturally disappear when xterm trims scrollback.  A
  // WeakMap therefore preserves already-coloured history without an arbitrary
  // LRU eviction/recompute cycle and without retaining discarded lines.
  let cache = new WeakMap<XtermBufferLine, CachedLineDecoration>();
  let detach: (() => void) | undefined;
  let sourceRules: TerminalHighlightRule[] | undefined;
  let renderRules: TerminalHighlightRule[] = [];
  let jsonStyles: JsonHighlightStyles = createJsonHighlightStyles([]);
  let resolveRanges: ReturnType<typeof createTerminalHighlightRangeResolver> = () => [];

  const resolveLine = (
    line: Pick<XtermBufferLine, 'length' | 'translateToString'>,
    logicalContext?: LogicalLineContext,
  ): TerminalRenderLineDecoration | undefined => {
    const sourceOptions = getOptions();
    if (sourceRules !== sourceOptions.rules) {
      sourceRules = sourceOptions.rules;
      renderRules = sourceRules.filter(rule => !DENSE_RENDER_PRESET_IDS.has(rule.id));
      jsonStyles = createJsonHighlightStyles(sourceRules);
      resolveRanges = createTerminalHighlightRangeResolver({ ...sourceOptions, rules: renderRules });
      cache = new WeakMap();
    }
    const options = { ...sourceOptions, rules: renderRules };
    if (!options.enabled || sourceOptions.rules.length === 0) {
      return undefined;
    }

    const { text, columns } = getLineTextAndColumns(line);
    if (!text) {
      return undefined;
    }

    const cached = cache.get(line as XtermBufferLine);
    if (cached && cached.text === text
      && cached.logicalText === logicalContext?.text
      && cached.rowTextOffset === (logicalContext?.rowTextOffset ?? 0)
      && cached.rules === options.rules && cached.enabled === options.enabled) {
      return cached.hasStyles ? cached : undefined;
    }

    const styles: Array<ResolvedCellStyle | undefined> = new Array(line.length);
    const highlightText = logicalContext?.text ?? text;
    const rowTextOffset = logicalContext?.rowTextOffset ?? 0;
    const ranges = [
      ...resolveRanges(highlightText),
      // JSON semantic tokens deliberately come last so a broad generic quoted
      // string rule cannot recolour keys and punctuation inconsistently.
      ...resolveJsonRanges(highlightText, jsonStyles),
    ].filter(range => range.end > rowTextOffset && range.start < rowTextOffset + text.length)
      .map(range => ({
        ...range,
        start: Math.max(0, range.start - rowTextOffset),
        end: Math.min(text.length, range.end - rowTextOffset),
      }));
    for (const range of ranges) {
      const start = columns[range.start];
      const end = columns[range.end];
      if (start === undefined || end === undefined || end <= start) continue;
      const resolvedStyle: ResolvedCellStyle = {
        ...range,
        foregroundRgb: range.foreground ? parseRgbColor(range.foreground) : undefined,
        backgroundRgb: range.background ? parseRgbColor(range.background) : undefined,
      };
      for (let column = start; column < Math.min(end, line.length); column += 1) {
        styles[column] = resolvedStyle;
      }
    }

    const decoration: CachedLineDecoration = {
      text,
      logicalText: logicalContext?.text,
      rowTextOffset,
      rules: options.rules,
      enabled: options.enabled,
      styles,
      hasStyles: styles.some(Boolean),
    };
    cache.set(line as XtermBufferLine, decoration);
    return decoration.hasStyles ? decoration : undefined;
  };

  const attach = (terminal: Terminal): boolean => {
    detach?.();

    const rendererSlot = (terminal as Terminal & XtermTerminalInternals)._core?._renderService?._renderer;
    // xterm 5.3 stores the active renderer in MutableDisposable.value. Keep
    // the direct fallback for compatible render-service implementations.
    const rowFactory = rendererSlot?.value?._rowFactory ?? rendererSlot?._rowFactory;
    if (!rowFactory || typeof rowFactory.createRow !== 'function') {
      return false;
    }

    const originalCreateRow = rowFactory.createRow;
    const bufferLines = (terminal as Terminal & XtermTerminalInternals)._core?._bufferService?.buffer?.lines;
    const createHighlightedRow = function (this: XtermRowFactory, ...args: unknown[]) {
      const line = args[0] as XtermBufferLine | undefined;
      if (!line) {
        return originalCreateRow.apply(this, args);
      }

      const row = typeof args[1] === 'number' ? args[1] : undefined;
      const logicalContext = row !== undefined && bufferLines
        ? getLogicalLineContext(bufferLines, row, line)
        : undefined;
      const decoration = resolveLine(line, logicalContext);
      if (!decoration) {
        return originalCreateRow.apply(this, args);
      }

      const decoratedLine = Object.create(line) as XtermBufferLine;
      decoratedLine.loadCell = (column: number, cell: XtermCellData) => {
        const result = line.loadCell(column, cell);
        const style = decoration.styles[column];
        // Existing SGR colors belong to the remote program and have precedence
        // over local semantic coloring.
        if (!style || (result.fg & XTERM_COLOR_MODE_MASK) !== 0 || (result.bg & XTERM_COLOR_MODE_MASK) !== 0) {
          return result;
        }

        if (style.foregroundRgb !== undefined) {
          result.fg = (result.fg & ~(XTERM_COLOR_MODE_MASK | XTERM_RGB_MASK)) | XTERM_RGB_COLOR_MODE | style.foregroundRgb;
        }
        if (style.bold) {
          result.fg |= XTERM_BOLD_FLAG;
        }
        if (style.backgroundRgb !== undefined) {
          result.bg = (result.bg & ~(XTERM_COLOR_MODE_MASK | XTERM_RGB_MASK)) | XTERM_RGB_COLOR_MODE | style.backgroundRgb;
        }
        if (style.underline) {
          result.fg |= XTERM_UNDERLINE_FLAG;
          result.bg |= XTERM_HAS_EXTENDED_ATTRS_FLAG;
          result.extended = result.extended.clone();
          result.extended.underlineStyle = XTERM_SINGLE_UNDERLINE;
        }
        return result;
      };
      args[0] = decoratedLine;
      return originalCreateRow.apply(this, args);
    };
    rowFactory.createRow = createHighlightedRow;

    detach = () => {
      if (rowFactory.createRow === createHighlightedRow) {
        rowFactory.createRow = originalCreateRow;
      }
      detach = undefined;
      cache = new WeakMap();
    };
    return true;
  };

  return {
    attach,
    dispose: () => detach?.(),
    invalidate: () => { cache = new WeakMap(); sourceRules = undefined; },
    resolveLine,
  };
}

/** Settings preview uses the exact same range program and JSON semantic slots
 * as the real terminal renderer. This prevents a rule from looking different
 * in the editor than it does in xterm. */
export function previewTerminalRenderHighlightSegments(
  input: string,
  options: TerminalRenderHighlightOptions,
): TerminalHighlightPreviewSegment[] {
  if (!options.enabled || !input) return [{ text: input }];
  const renderRules = options.rules.filter(rule => !DENSE_RENDER_PRESET_IDS.has(rule.id));
  const resolveRanges = createTerminalHighlightRangeResolver({ ...options, rules: renderRules });
  const jsonStyles = createJsonHighlightStyles(options.rules);

  return input.split(/(\r\n|\n|\r)/).flatMap(part => {
    if (part === '\r\n' || part === '\n' || part === '\r' || !part) return [{ text: part }];
    const styles: Array<TerminalHighlightRange | undefined> = new Array(part.length);
    const ranges = [...resolveRanges(part), ...resolveJsonRanges(part, jsonStyles)];
    for (const range of ranges) {
      for (let index = Math.max(0, range.start); index < Math.min(part.length, range.end); index += 1) {
        styles[index] = range;
      }
    }
    const segments: TerminalHighlightPreviewSegment[] = [];
    let start = 0;
    while (start < part.length) {
      const current = styles[start];
      let end = start + 1;
      while (end < part.length && sameHighlightStyle(styles[end], current)) end += 1;
      segments.push({
        text: part.slice(start, end),
        foreground: current?.foreground,
        background: current?.background,
        bold: current?.bold,
        underline: current?.underline,
      });
      start = end;
    }
    return segments;
  });
}

function sameHighlightStyle(left?: TerminalHighlightRange, right?: TerminalHighlightRange): boolean {
  return left?.foreground === right?.foreground
    && left?.background === right?.background
    && left?.bold === right?.bold
    && left?.underline === right?.underline;
}

function getLogicalLineContext(
  lines: { get(index: number): XtermBufferLine | undefined; length?: number },
  row: number,
  currentLine: XtermBufferLine,
): LogicalLineContext | undefined {
  if (!currentLine.isWrapped && !lines.get(row + 1)?.isWrapped) return undefined;
  let startRow = row;
  let inspected = 0;
  while (startRow > 0 && lines.get(startRow)?.isWrapped && inspected++ < 64) startRow -= 1;

  let text = '';
  let rowTextOffset = 0;
  const maxRow = typeof lines.length === 'number' ? lines.length - 1 : row + 64;
  for (let currentRow = startRow; currentRow <= maxRow && currentRow <= startRow + 64; currentRow += 1) {
    const line = lines.get(currentRow);
    if (!line) break;
    if (currentRow === row) rowTextOffset = text.length;
    text += line.translateToString(true, 0, line.length);
    if (!lines.get(currentRow + 1)?.isWrapped) break;
  }
  return text ? { text, rowTextOffset } : undefined;
}

function parseRgbColor(value: string): number | undefined {
  const normalized = value.trim();
  const match = /^#([0-9a-f]{6})$/i.exec(normalized);
  if (!match) return undefined;
  return Number.parseInt(match[1], 16);
}

/**
 * xterm 5.3 does not expose the `outColumns` argument that newer releases
 * accept on `translateToString`. Build the UTF-16-to-cell mapping directly so
 * the render bridge works with the version shipped by this application.
 */
function getLineTextAndColumns(line: Pick<XtermBufferLine, 'length' | 'translateToString' | 'getTrimmedLength' | 'getWidth' | 'getString'>): {
  text: string;
  columns: number[];
} {
  const nativeColumns: number[] = [];
  const nativeText = line.translateToString(true, 0, line.length, nativeColumns);
  if (nativeColumns.length > 0) return { text: nativeText, columns: nativeColumns };
  if (!line.getWidth || !line.getString) return { text: nativeText, columns: nativeColumns };

  const end = line.getTrimmedLength?.() ?? line.length;
  const columns: number[] = [];
  let text = '';
  let column = 0;
  while (column < end) {
    const width = line.getWidth(column);
    const chars = line.getString(column) || ' ';
    for (let index = 0; index < chars.length; index += 1) {
      columns.push(column);
    }
    text += chars;
    column += width || 1;
  }
  columns.push(column);
  return { text, columns };
}

/** Linear JSON lexer for visual rows. It does not require a complete object,
 * so wrapped JSON remains highlighted after resize. Each JSON fragment is one
 * range, avoiding the hundreds of DOM spans produced by token regexes. */
// Bound work for pathological payloads while still covering a full 4KB logical
// line. Only tokens intersecting the current visual row become cell styles.
const MAX_JSON_TOKENS_PER_LOGICAL_LINE = 256;
const MAX_JSON_TOKENS_TOTAL = 512;
const MAX_JSON_STRUCTURES_PER_LINE = 8;

function createJsonHighlightStyles(rules: TerminalHighlightRule[]): JsonHighlightStyles {
  // IDs are ordered by preference: semantic JSON slots must win over generic
  // fallback rules even though generic rules appear earlier in the document.
  const find = (...ids: string[]) => ids
    .map(id => rules.find(rule => rule.enabled && rule.id === id))
    .find((rule): rule is TerminalHighlightRule => Boolean(rule));
  const semanticIds = new Set([
    'preset-json-boundary', 'preset-json-key', 'preset-json-string',
    'preset-json-number', 'preset-json-literal', 'preset-json-punctuation',
  ]);
  const semanticRules = rules.filter(rule => semanticIds.has(rule.id));
  const semanticMode = semanticRules.length > 0;
  const jsonRule = find(
    'preset-json-boundary',
    'preset-json-inline-object', 'preset-json-inline-array',
    'preset-json-pretty-key-value-line', 'preset-json-pretty-bracket-line',
  );
  const enabledJsonRules = rules.filter(rule => rule.enabled && rule.id.startsWith('preset-json-'));
  // Older saved defaults used the same green for every JSON rule. Treat that
  // exact legacy palette as defaults so users receive semantic colours without
  // having to reset their customised rule document.
  const legacyMonochromeJson = enabledJsonRules.length > 1
    && enabledJsonRules.every(rule => rule.foreground?.toUpperCase() === '#98C379');
  const style = (rule: TerminalHighlightRule | undefined, fallback: string): Partial<TerminalHighlightRange> => ({
    foreground: rule?.foreground ?? fallback,
    background: rule?.background,
    bold: rule?.bold,
    underline: rule?.underline,
  });
  const slot = (ids: string[], fallback: string) => {
    const rule = find(...ids);
    return semanticMode ? (rule ? style(rule, fallback) : {}) : style(rule, fallback);
  };
  return {
    enabled: semanticMode ? semanticRules.some(rule => rule.enabled) : Boolean(jsonRule),
    key: slot(legacyMonochromeJson ? [] : ['preset-json-key', 'preset-json-pretty-key-value-line'], '#9CDCFE'),
    string: slot(['preset-json-string', 'preset-double-quoted-string'], '#CE9178'),
    number: slot(['preset-json-number', 'preset-number'], '#B5CEA8'),
    literal: slot(['preset-json-literal'], '#569CD6'),
    boundary: semanticMode
      ? slot(['preset-json-boundary'], '#C586C0')
      : legacyMonochromeJson
        ? { foreground: '#C586C0', bold: true }
        : style(jsonRule, '#C586C0'),
    punctuation: slot(legacyMonochromeJson ? [] : ['preset-json-punctuation', 'preset-json-pretty-bracket-line'], '#7A8599'),
  };
}

function resolveJsonRanges(text: string, styles: JsonHighlightStyles): TerminalHighlightRange[] {
  if (!styles.enabled) return [];
  const ranges: TerminalHighlightRange[] = [];
  const push = (tokenStart: number, tokenEnd: number, style: Partial<TerminalHighlightRange>) => {
    if (ranges.length >= MAX_JSON_TOKENS_TOTAL || tokenEnd <= tokenStart) return;
    ranges.push({ start: tokenStart, end: tokenEnd, ...style });
  };

  let searchOffset = 0;
  for (let structureCount = 0; structureCount < MAX_JSON_STRUCTURES_PER_LINE && ranges.length < MAX_JSON_TOKENS_TOTAL; structureCount += 1) {
    const start = findJsonStart(text, searchOffset);
    if (start < 0) break;
    const outerEnd = findJsonStructureEnd(text, start);
    const structureEnd = outerEnd > start ? outerEnd : text.length;
    const rangeCountBeforeStructure = ranges.length;

    for (let index = start; index < structureEnd && ranges.length - rangeCountBeforeStructure < MAX_JSON_TOKENS_PER_LOGICAL_LINE;) {
      const char = text[index];
      if ('{}[],:'.includes(char)) {
        const isOuterBoundary = index === start || (outerEnd > start && index === outerEnd - 1);
        push(index, index + 1, isOuterBoundary ? styles.boundary : styles.punctuation);
        index += 1;
        continue;
      }
      if (char === '"') {
        const tokenStart = index++;
        let escaped = false;
        while (index < structureEnd) {
          const next = text[index++];
          if (escaped) escaped = false;
          else if (next === '\\') escaped = true;
          else if (next === '"') break;
        }
        let next = index;
        while (next < structureEnd && /\s/.test(text[next])) next += 1;
        const value = text.slice(tokenStart + 1, Math.max(tokenStart + 1, index - 1));
        if (!/^https?:\/\//i.test(value)) {
          push(tokenStart, index, text[next] === ':' ? styles.key : styles.string);
        }
        continue;
      }
      if ((char === '-' || char === '+' || /\d/.test(char)) && isJsonValueBoundary(text, index - 1)) {
        const match = /^[-+]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index, structureEnd));
        if (match) {
          push(index, index + match[0].length, styles.number);
          index += match[0].length;
          continue;
        }
      }
      const literal = /^(?:true|false|null)(?![\w-])/.exec(text.slice(index, structureEnd));
      if (literal && isJsonValueBoundary(text, index - 1)) {
        push(index, index + literal[0].length, styles.literal);
        index += literal[0].length;
        continue;
      }
      index += 1;
    }

    if (outerEnd <= start) break;
    searchOffset = outerEnd;
  }
  return ranges;
}

function findJsonStructureEnd(text: string, start: number): number {
  const opener = text[start];
  if (opener !== '{' && opener !== '[') return -1;
  const stack: string[] = [opener];
  let inString = false;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '[';
      if (stack[stack.length - 1] !== expected) return -1;
      stack.pop();
      if (stack.length === 0) return index + 1;
    }
  }
  return -1;
}

function findJsonStart(text: string, from = 0): number {
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      const closingQuote = findClosingJsonQuote(text, index + 1);
      if (closingQuote > index) {
        let next = closingQuote + 1;
        while (next < text.length && /\s/.test(text[next])) next += 1;
        if (text[next] === ':') return index;
        index = closingQuote;
      }
      continue;
    }
    if (char !== '{' && char !== '[') continue;
    let next = index + 1;
    while (next < text.length && /\s/.test(text[next])) next += 1;
    const candidate = text[next];
    if (char === '{' && (candidate === '"' || candidate === '}')) return index;
    if (char === '[' && (candidate === '"' || candidate === '{' || candidate === '[' || candidate === ']'
      || candidate === '-' || /\d/.test(candidate) || text.startsWith('true', next)
      || text.startsWith('false', next) || text.startsWith('null', next))) return index;
  }
  return -1;
}

function findClosingJsonQuote(text: string, start: number): number {
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    if (escaped) escaped = false;
    else if (text[index] === '\\') escaped = true;
    else if (text[index] === '"') return index;
  }
  return -1;
}

function isJsonValueBoundary(text: string, index: number): boolean {
  while (index >= 0 && /\s/.test(text[index])) index -= 1;
  return index < 0 || ':,[{'.includes(text[index]);
}

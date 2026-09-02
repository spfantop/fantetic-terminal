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

type XtermTextLine = Pick<
  XtermBufferLine,
  'length' | 'translateToString' | 'getTrimmedLength' | 'getWidth' | 'getString'
>;

interface LineTextProjection {
  text: string;
  columns: number[];
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
  error: Partial<TerminalHighlightRange>;
  boundary: Partial<TerminalHighlightRange>;
  punctuation: Partial<TerminalHighlightRange>;
}

type TerminalRenderTextScope =
  | { kind: 'general' }
  | { kind: 'header'; headerName: string; prefixEnd: number; valueStart: number }
  | { kind: 'json'; jsonStart: number };

type ScopedHighlightRangeResolver = (
  text: string,
  scope: TerminalRenderTextScope,
) => TerminalHighlightRange[];

interface CachedLineDecoration extends TerminalRenderLineDecoration {
  text: string;
  logicalText?: string;
  rowTextOffset: number;
  rules: TerminalHighlightRule[];
  enabled: boolean;
  hasStyles: boolean;
  contentRevision: number;
}

/**
 * Supplies highlight attributes only while xterm builds a DOM row. No buffer
 * cells, terminal bytes or generated DOM are mutated, which keeps cursor,
 * reflow and scrollback ownership entirely inside xterm.
 */
export function createTerminalRenderHighlighter(getOptions: () => TerminalRenderHighlightOptions) {
  // xterm retains BufferLine objects for the entire scrollback lifetime, so a
  // WeakMap would also retain every per-cell style array the user ever viewed.
  // Keep only a bounded working set; semantic ranges have their own text LRU.
  let cache = new Map<XtermBufferLine, CachedLineDecoration>();
  let detach: ((preserveTextCache?: boolean) => void) | undefined;
  let sourceRules: TerminalHighlightRule[] | undefined;
  let renderRules: TerminalHighlightRule[] = [];
  let jsonStyles: JsonHighlightStyles = createJsonHighlightStyles([]);
  let resolveRanges: ScopedHighlightRangeResolver = () => [];
  let resolvedTextRanges = new Map<string, ResolvedCellStyle[]>();
  let resolvedTextRangeCacheWeight = 0;
  let resolvedTextCacheCharacters = 0;
  let parsedRgbColors = new Map<string, number | undefined>();
  let logicalLineContexts = new Map<XtermBufferLine, LogicalLineContext | null>();
  let lineTextProjections = new Map<XtermBufferLine, LineTextProjection>();
  let contentCacheDisposables: Array<{ dispose(): void }> = [];
  let rangeResolutionCount = 0;
  let lineDecorationBuildCount = 0;
  // A write can mutate BufferLine objects in place. Validate rendered rows once
  // per write cycle, while retaining exact-text decorations for unchanged rows.
  let contentRevision = 0;
  let attachedTerminal: Terminal | undefined;
  let attachedRowFactory: XtermRowFactory | undefined;
  let attachedCreateRow: XtermRowFactory['createRow'] | undefined;
  const MAX_RESOLVED_TEXT_CACHE_ENTRIES = 4096;
  const MAX_RESOLVED_RANGE_CACHE_WEIGHT = 32_768;
  const MAX_RESOLVED_TEXT_CACHE_CHARACTERS = 4 * 1024 * 1024;
  const MAX_LINE_DECORATION_CACHE_ENTRIES = 1024;
  const MAX_LOGICAL_LINE_CONTEXT_CACHE_ENTRIES = 1024;

  const clearLineCaches = () => {
    cache = new Map();
    clearLogicalLineCaches();
  };

  const clearLogicalLineCaches = () => {
    logicalLineContexts = new Map();
    lineTextProjections = new Map();
  };

  const clearResolvedCaches = () => {
    clearLineCaches();
    resolvedTextRanges = new Map();
    resolvedTextRangeCacheWeight = 0;
    resolvedTextCacheCharacters = 0;
    parsedRgbColors = new Map();
  };

  const resolveRgbColor = (value?: string): number | undefined => {
    if (!value) return undefined;
    if (parsedRgbColors.has(value)) return parsedRgbColors.get(value);
    const parsed = parseRgbColor(value);
    parsedRgbColors.set(value, parsed);
    return parsed;
  };

  const readRenderOptions = () => {
    const sourceOptions = getOptions();
    if (sourceRules !== sourceOptions.rules) {
      sourceRules = sourceOptions.rules;
      renderRules = sourceRules.filter(rule => !DENSE_RENDER_PRESET_IDS.has(rule.id));
      jsonStyles = createJsonHighlightStyles(sourceRules);
      resolveRanges = createScopedHighlightRangeResolver(sourceOptions, renderRules);
      clearResolvedCaches();
    }
    return { ...sourceOptions, rules: renderRules };
  };

  const readCachedLineDecoration = (line: XtermBufferLine): CachedLineDecoration | undefined => {
    const options = readRenderOptions();
    if (!options.enabled) return undefined;
    const cached = cache.get(line);
    if (!cached || cached.contentRevision !== contentRevision
      || cached.rules !== renderRules || cached.enabled !== options.enabled) return undefined;
    cache.delete(line);
    cache.set(line, cached);
    return cached;
  };

  const resolveTextRanges = (text: string): ResolvedCellStyle[] => {
    const cached = resolvedTextRanges.get(text);
    if (cached) {
      // Refresh insertion order so frequently rendered history stays hot.
      resolvedTextRanges.delete(text);
      resolvedTextRanges.set(text, cached);
      return cached;
    }

    rangeResolutionCount += 1;
    const ranges = resolveRenderRanges(text, resolveRanges, jsonStyles)
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .map(range => ({
        ...range,
        foregroundRgb: resolveRgbColor(range.foreground),
        backgroundRgb: resolveRgbColor(range.background),
      }));
    resolvedTextRanges.set(text, ranges);
    resolvedTextRangeCacheWeight += ranges.length;
    resolvedTextCacheCharacters += text.length;
    while (resolvedTextRanges.size > MAX_RESOLVED_TEXT_CACHE_ENTRIES
      || resolvedTextRangeCacheWeight > MAX_RESOLVED_RANGE_CACHE_WEIGHT
      || resolvedTextCacheCharacters > MAX_RESOLVED_TEXT_CACHE_CHARACTERS) {
      const oldest = resolvedTextRanges.keys().next().value;
      if (oldest === undefined) break;
      resolvedTextRangeCacheWeight -= resolvedTextRanges.get(oldest)?.length ?? 0;
      resolvedTextCacheCharacters -= oldest.length;
      resolvedTextRanges.delete(oldest);
    }
    return ranges;
  };

  const resolveLine = (
    line: XtermTextLine,
    logicalContext?: LogicalLineContext,
    textProjection?: LineTextProjection,
  ): TerminalRenderLineDecoration | undefined => {
    const options = readRenderOptions();
    if (!options.enabled || sourceRules?.length === 0) {
      return undefined;
    }

    const { text, columns } = textProjection ?? getLineTextAndColumns(line);
    if (!text) {
      return undefined;
    }

    const cached = cache.get(line as XtermBufferLine);
    if (cached && cached.text === text
      && cached.logicalText === logicalContext?.text
      && cached.rowTextOffset === (logicalContext?.rowTextOffset ?? 0)
      && cached.rules === options.rules && cached.enabled === options.enabled) {
      cached.contentRevision = contentRevision;
      cache.delete(line as XtermBufferLine);
      cache.set(line as XtermBufferLine, cached);
      return cached.hasStyles ? cached : undefined;
    }

    const renderedCellCount = Math.min(line.length, columns[columns.length - 1] ?? 0);
    const styles: Array<ResolvedCellStyle | undefined> = new Array(renderedCellCount);
    const highlightText = logicalContext?.text ?? text;
    const rowTextOffset = logicalContext?.rowTextOffset ?? 0;
    const rowTextEnd = rowTextOffset + text.length;
    const ranges = resolveTextRanges(highlightText);
    let hasStyles = false;
    for (
      let index = findFirstRangeIntersectingRow(ranges, rowTextOffset);
      index < ranges.length && ranges[index].start < rowTextEnd;
      index += 1
    ) {
      const range = ranges[index];
      if (range.end <= rowTextOffset) continue;
      const rangeStart = Math.max(0, range.start - rowTextOffset);
      const rangeEnd = Math.min(text.length, range.end - rowTextOffset);
      const start = columns[rangeStart];
      const end = columns[rangeEnd];
      if (start === undefined || end === undefined || end <= start) continue;
      for (let column = start; column < Math.min(end, line.length); column += 1) {
        styles[column] = range;
      }
      hasStyles = true;
    }

    const decoration: CachedLineDecoration = {
      text,
      logicalText: logicalContext?.text,
      rowTextOffset,
      rules: options.rules,
      enabled: options.enabled,
      styles,
      hasStyles,
      contentRevision,
    };
    lineDecorationBuildCount += 1;
    cache.set(line as XtermBufferLine, decoration);
    if (cache.size > MAX_LINE_DECORATION_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return decoration.hasStyles ? decoration : undefined;
  };

  const attach = (terminal: Terminal): boolean => {
    detach?.(true);

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

      const cachedDecoration = readCachedLineDecoration(line);
      const row = typeof args[1] === 'number' ? args[1] : undefined;
      const logicalContext = cachedDecoration || row === undefined || !bufferLines
        ? undefined
        : getLogicalLineContext(
          bufferLines,
          row,
          line,
          logicalLineContexts,
          lineTextProjections,
          MAX_LOGICAL_LINE_CONTEXT_CACHE_ENTRIES,
        );
      const resolvedDecoration = cachedDecoration ?? resolveLine(
        line,
        logicalContext,
        lineTextProjections.get(line),
      );
      const decoration = resolvedDecoration && ('hasStyles' in resolvedDecoration
        ? resolvedDecoration.hasStyles
        : resolvedDecoration.styles.some(Boolean))
        ? resolvedDecoration
        : undefined;
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
    attachedTerminal = terminal;
    attachedRowFactory = rowFactory;
    attachedCreateRow = createHighlightedRow;
    const contentEvents = terminal as Partial<Pick<Terminal, 'onWriteParsed' | 'onResize'>>;
    contentCacheDisposables = [
      contentEvents.onWriteParsed?.(() => {
        contentRevision += 1;
        clearLogicalLineCaches();
      }),
      contentEvents.onResize?.(() => clearLineCaches()),
    ].filter((disposable): disposable is { dispose(): void } => Boolean(disposable));

    detach = (preserveTextCache = false) => {
      if (rowFactory.createRow === createHighlightedRow) {
        rowFactory.createRow = originalCreateRow;
      }
      detach = undefined;
      attachedTerminal = undefined;
      attachedRowFactory = undefined;
      attachedCreateRow = undefined;
      contentCacheDisposables.forEach(disposable => disposable.dispose());
      contentCacheDisposables = [];
      clearLineCaches();
      if (!preserveTextCache) {
        resolvedTextRanges = new Map();
        resolvedTextRangeCacheWeight = 0;
        resolvedTextCacheCharacters = 0;
      }
    };
    return true;
  };

  return {
    attach,
    dispose: () => detach?.(),
    ensureAttached: (terminal: Terminal = attachedTerminal!) => {
      if (!terminal) return false;
      const rendererSlot = (terminal as Terminal & XtermTerminalInternals)._core?._renderService?._renderer;
      const currentRowFactory = rendererSlot?.value?._rowFactory ?? rendererSlot?._rowFactory;
      if (currentRowFactory === attachedRowFactory && currentRowFactory?.createRow === attachedCreateRow) return true;
      return attach(terminal);
    },
    getStats: () => ({
      rangeResolutionCount,
      lineDecorationBuildCount,
      resolvedTextRangeCacheWeight,
      resolvedTextCacheCharacters,
      resolvedTextCacheSize: resolvedTextRanges.size,
      lineDecorationCacheSize: cache.size,
      logicalLineContextCacheSize: logicalLineContexts.size,
      lineTextProjectionCacheSize: lineTextProjections.size,
    }),
    invalidate: () => { clearResolvedCaches(); sourceRules = undefined; },
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
  const resolveRanges = createScopedHighlightRangeResolver(options, renderRules);
  const jsonStyles = createJsonHighlightStyles(options.rules);

  return input.split(/(\r\n|\n|\r)/).flatMap(part => {
    if (part === '\r\n' || part === '\n' || part === '\r' || !part) return [{ text: part }];
    const styles: Array<TerminalHighlightRange | undefined> = new Array(part.length);
    const ranges = resolveRenderRanges(part, resolveRanges, jsonStyles);
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

// Request headers frequently carry opaque cookies and credentials. Apply only
// field-relevant presets there so generic token rules cannot fragment secrets.
const REQUEST_HEADER_PATTERN = /^\s*=+Headers=+\s+([^:\s]+)\s*:\s*/i;
const FEIGN_HEADER_PATTERN = /\[ThirdPartyFeign\]\s+(?:\[[^\]\r\n]+\]\s+)?([A-Za-z][A-Za-z0-9-]*)\s*:\s*/i;
const URL_HEADER_NAMES = new Set(['referer', 'referrer', 'origin', 'location', 'content-location']);
const HOST_HEADER_NAMES = new Set(['host', 'x-forwarded-host', 'forwarded']);
const URL_HEADER_PRESET_IDS = new Set(['url', 'domain', 'ipv4', 'ipv4Port', 'ipv6']);
const HOST_HEADER_PRESET_IDS = new Set(['domain', 'ipv4', 'ipv4Port', 'ipv6']);
const JSON_RELEVANT_PRESET_IDS = new Set([
  'fatal', 'error', 'exceptionWord', 'warning', 'success', 'info', 'debug',
  'url', 'linuxPath', 'windowsPath', 'fileLine',
  'ipv4', 'ipv4Port', 'ipv6', 'domain',
  'size', 'duration', 'percent',
  'httpStatusError', 'httpStatusRedirect', 'httpStatusOk', 'httpMethod',
  'javaException', 'traceId', 'uuid',
]);

function createScopedHighlightRangeResolver(
  options: TerminalHighlightOptions,
  rules: TerminalHighlightRule[],
): ScopedHighlightRangeResolver {
  const createResolver = (scopedRules: TerminalHighlightRule[]) => createTerminalHighlightRangeResolver({
    ...options,
    rules: scopedRules,
  });
  const generalResolver = createResolver(rules);
  const customRules = rules.filter(rule => !rule.presetId);
  const customResolver = createResolver(customRules);
  const urlHeaderResolver = createResolver(rules.filter(
    rule => !rule.presetId || URL_HEADER_PRESET_IDS.has(rule.presetId),
  ));
  const hostHeaderResolver = createResolver(rules.filter(
    rule => !rule.presetId || HOST_HEADER_PRESET_IDS.has(rule.presetId),
  ));
  const jsonResolver = createResolver(rules.filter(
    rule => !rule.presetId || JSON_RELEVANT_PRESET_IDS.has(rule.presetId),
  ));
  const resolveSlice = (
    resolver: (text: string) => TerminalHighlightRange[],
    text: string,
    start: number,
    end = text.length,
  ) => resolver(text.slice(start, end)).map(range => ({
    ...range,
    start: range.start + start,
    end: range.end + start,
  }));

  return (text: string, scope: TerminalRenderTextScope) => {
    if (scope.kind === 'header') {
      const valueResolver = URL_HEADER_NAMES.has(scope.headerName)
        ? urlHeaderResolver
        : HOST_HEADER_NAMES.has(scope.headerName)
          ? hostHeaderResolver
          : customResolver;
      return [
        ...resolveSlice(generalResolver, text, 0, scope.prefixEnd),
        ...resolveSlice(valueResolver, text, scope.valueStart),
      ];
    }
    if (scope.kind === 'json') {
      return [
        ...resolveSlice(generalResolver, text, 0, scope.jsonStart),
        ...resolveSlice(jsonResolver, text, scope.jsonStart),
      ];
    }
    return generalResolver(text);
  };
}

function resolveRenderRanges(
  text: string,
  resolveRanges: ScopedHighlightRangeResolver,
  jsonStyles: JsonHighlightStyles,
): TerminalHighlightRange[] {
  const scope = classifyTerminalRenderText(text);
  const ruleRanges = resolveRanges(text, scope);
  if (scope.kind !== 'json') return ruleRanges;
  return [...ruleRanges, ...resolveJsonRanges(text, jsonStyles, scope.jsonStart)];
}

function classifyTerminalRenderText(text: string): TerminalRenderTextScope {
  const header = REQUEST_HEADER_PATTERN.exec(text) ?? FEIGN_HEADER_PATTERN.exec(text);
  if (header) {
    return {
      kind: 'header',
      headerName: header[1].toLowerCase().replaceAll('_', '-'),
      prefixEnd: header.index,
      valueStart: header.index + header[0].length,
    };
  }
  const jsonStart = findJsonStart(text, 0, Math.min(text.length, MAX_JSON_SCAN_LENGTH));
  if (jsonStart >= 0) return { kind: 'json', jsonStart };
  return { kind: 'general' };
}

function findFirstRangeIntersectingRow(
  ranges: TerminalHighlightRange[],
  rowStart: number,
): number {
  let prefixMaxEnds = RANGE_PREFIX_MAX_END_CACHE.get(ranges);
  if (!prefixMaxEnds) {
    prefixMaxEnds = new Array(ranges.length);
    let maxEnd = 0;
    for (let index = 0; index < ranges.length; index += 1) {
      maxEnd = Math.max(maxEnd, ranges[index].end);
      prefixMaxEnds[index] = maxEnd;
    }
    RANGE_PREFIX_MAX_END_CACHE.set(ranges, prefixMaxEnds);
  }

  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (prefixMaxEnds[middle] <= rowStart) low = middle + 1;
    else high = middle;
  }

  return low;
}

const RANGE_PREFIX_MAX_END_CACHE = new WeakMap<TerminalHighlightRange[], number[]>();

function getLogicalLineContext(
  lines: { get(index: number): XtermBufferLine | undefined; length?: number },
  row: number,
  currentLine: XtermBufferLine,
  cache?: Map<XtermBufferLine, LogicalLineContext | null>,
  projectionCache?: Map<XtermBufferLine, LineTextProjection>,
  maxCacheEntries = 1024,
): LogicalLineContext | undefined {
  if (cache?.has(currentLine)) return cache.get(currentLine) ?? undefined;
  if (!currentLine.isWrapped && !lines.get(row + 1)?.isWrapped) {
    cache?.set(currentLine, null);
    return undefined;
  }
  let startRow = row;
  let inspected = 0;
  while (startRow > 0 && lines.get(startRow)?.isWrapped && inspected++ < 64) startRow -= 1;

  let text = '';
  let rowTextOffset = 0;
  const logicalLineList: Array<{ line: XtermBufferLine; rowTextOffset: number }> = [];
  const maxRow = typeof lines.length === 'number' ? lines.length - 1 : row + 64;
  for (let currentRow = startRow; currentRow <= maxRow && currentRow <= startRow + 64; currentRow += 1) {
    const line = lines.get(currentRow);
    if (!line) break;
    logicalLineList.push({ line, rowTextOffset: text.length });
    if (currentRow === row) rowTextOffset = text.length;
    const projection = getLineTextAndColumns(line);
    text += projection.text;
    if (projectionCache) {
      projectionCache.delete(line);
      projectionCache.set(line, projection);
    }
    if (!lines.get(currentRow + 1)?.isWrapped) break;
  }
  if (text && cache) {
    for (const entry of logicalLineList) {
      cache.set(entry.line, { text, rowTextOffset: entry.rowTextOffset });
    }
    while (cache.size > maxCacheEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  if (projectionCache) {
    while (projectionCache.size > maxCacheEntries) {
      const oldest = projectionCache.keys().next().value;
      if (oldest === undefined) break;
      projectionCache.delete(oldest);
    }
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
function getLineTextAndColumns(line: XtermTextLine): {
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
 * so wrapped JSON remains highlighted after resize. Dense payloads omit string
 * values and punctuation to keep xterm DOM span creation predictably bounded. */
// Bound pathological payload work: detect JSON within the first 16KB and scan
// at most 128KB continuously so string state survives internal boundaries.
// Only ranges intersecting the current visual row become cell styles.
const MAX_JSON_TOKENS_PER_LOGICAL_LINE = 128;
const MAX_JSON_TOKENS_TOTAL = 4096;
const MAX_JSON_STRUCTURES_PER_LINE = 8;
const MAX_JSON_SCAN_LENGTH = 16_384;
const MAX_JSON_TOTAL_SCAN_LENGTH = MAX_JSON_SCAN_LENGTH * MAX_JSON_STRUCTURES_PER_LINE;
const DENSE_JSON_STRUCTURE_LENGTH = 768;
const MAX_DENSE_JSON_RANGES_PER_STRUCTURE = 4096;
const MAX_DENSE_JSON_PRIMITIVE_RANGES = 8;

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
  const errorRule = find('preset-error', 'preset-http-status-error', 'preset-fatal');
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
    error: errorRule ? style(errorRule, '#FF6363') : {},
    boundary: semanticMode
      ? slot(['preset-json-boundary'], '#C586C0')
      : legacyMonochromeJson
        ? { foreground: '#C586C0', bold: true }
        : style(jsonRule, '#C586C0'),
    punctuation: slot(legacyMonochromeJson ? [] : ['preset-json-punctuation', 'preset-json-pretty-bracket-line'], '#7A8599'),
  };
}

function resolveJsonRanges(
  text: string,
  styles: JsonHighlightStyles,
  firstJsonStart: number,
): TerminalHighlightRange[] {
  if (!styles.enabled) return [];
  const ranges: TerminalHighlightRange[] = [];
  const push = (tokenStart: number, tokenEnd: number, style: Partial<TerminalHighlightRange>) => {
    if (ranges.length >= MAX_JSON_TOKENS_TOTAL || tokenEnd <= tokenStart) return;
    ranges.push({ start: tokenStart, end: tokenEnd, ...style });
  };

  let searchOffset = firstJsonStart;
  const scanLimit = Math.min(text.length, firstJsonStart + MAX_JSON_TOTAL_SCAN_LENGTH);
  for (let structureCount = 0; structureCount < MAX_JSON_STRUCTURES_PER_LINE && ranges.length < MAX_JSON_TOKENS_TOTAL; structureCount += 1) {
    const start = structureCount === 0 ? firstJsonStart : findJsonStart(text, searchOffset, scanLimit);
    if (start < 0) break;
    const outerEnd = findJsonStructureEnd(text, start, scanLimit);
    const structureEnd = outerEnd > start ? outerEnd : scanLimit;
    const rangeCountBeforeStructure = ranges.length;
    const denseStructure = structureEnd - start > DENSE_JSON_STRUCTURE_LENGTH;
    const structureRangeLimit = denseStructure
      ? MAX_DENSE_JSON_RANGES_PER_STRUCTURE
      : MAX_JSON_TOKENS_PER_LOGICAL_LINE;
    let densePrimitiveRangeCount = 0;
    let activeKey: string | undefined;
    let structureHasError = false;
    const pendingErrorMessageList: Array<{ start: number; end: number }> = [];

    for (let index = start; index < structureEnd && ranges.length - rangeCountBeforeStructure < structureRangeLimit;) {
      const char = text[index];
      if ('{}[],:'.includes(char)) {
        const isOuterBoundary = index === start || (outerEnd > start && index === outerEnd - 1);
        if (isOuterBoundary || !denseStructure) {
          push(index, index + 1, isOuterBoundary ? styles.boundary : styles.punctuation);
        }
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
        const isKey = text[next] === ':';
        const isUrl = text.startsWith('http://', tokenStart + 1) || text.startsWith('https://', tokenStart + 1);
        const isErrorMessage = !isKey && isJsonErrorMessageKey(activeKey) && index > tokenStart + 2;
        if (isErrorMessage) {
          pendingErrorMessageList.push({ start: tokenStart, end: index });
        } else if (!isUrl && (isKey || !denseStructure)) {
          push(tokenStart, index, isKey ? styles.key : styles.string);
        }
        activeKey = isKey ? text.slice(tokenStart + 1, index - 1).toLowerCase() : undefined;
        continue;
      }
      if ((char === '-' || char === '+' || isAsciiDigit(char)) && isJsonValueBoundary(text, index - 1)) {
        const numberEnd = findJsonNumberEnd(text, index, structureEnd);
        if (numberEnd > index) {
          const value = Number(text.slice(index, numberEnd));
          const isErrorCode = isJsonErrorCode(activeKey, value);
          if (isErrorCode) structureHasError = true;
          if (!denseStructure || isErrorCode || densePrimitiveRangeCount < MAX_DENSE_JSON_PRIMITIVE_RANGES) {
            push(index, numberEnd, isErrorCode ? styles.error : styles.number);
            if (denseStructure && !isErrorCode) densePrimitiveRangeCount += 1;
          }
          activeKey = undefined;
          index = numberEnd;
          continue;
        }
      }
      const literalLength = findJsonLiteralLength(text, index, structureEnd);
      if (literalLength > 0 && isJsonValueBoundary(text, index - 1)) {
        const literal = text.slice(index, index + literalLength);
        const isFailure = isJsonFailureLiteral(activeKey, literal);
        if (isFailure) structureHasError = true;
        if (!denseStructure || isFailure || densePrimitiveRangeCount < MAX_DENSE_JSON_PRIMITIVE_RANGES) {
          push(index, index + literalLength, isFailure ? styles.error : styles.literal);
          if (denseStructure && !isFailure) densePrimitiveRangeCount += 1;
        }
        activeKey = undefined;
        index += literalLength;
        continue;
      }
      index += 1;
    }

    for (const message of pendingErrorMessageList) {
      push(message.start, message.end, structureHasError ? styles.error : styles.string);
    }

    if (denseStructure && outerEnd > start && ranges.length < MAX_JSON_TOKENS_TOTAL) {
      const closingStart = outerEnd - 1;
      if (!ranges.some(range => range.start === closingStart)) {
        push(closingStart, outerEnd, styles.boundary);
      }
    }

    if (outerEnd <= start) break;
    searchOffset = outerEnd;
  }
  return ranges;
}

function findJsonNumberEnd(text: string, start: number, end: number): number {
  let index = start;
  if (text[index] === '-' || text[index] === '+') index += 1;
  const integerStart = index;
  while (index < end && isAsciiDigit(text[index])) index += 1;
  if (index === integerStart) return start;
  if (text[index] === '.') {
    const fractionStart = ++index;
    while (index < end && isAsciiDigit(text[index])) index += 1;
    if (index === fractionStart) return start;
  }
  if (text[index] === 'e' || text[index] === 'E') {
    index += 1;
    if (text[index] === '-' || text[index] === '+') index += 1;
    const exponentStart = index;
    while (index < end && isAsciiDigit(text[index])) index += 1;
    if (index === exponentStart) return start;
  }
  return index;
}

function findJsonLiteralLength(text: string, start: number, end: number): number {
  for (const literal of ['true', 'false', 'null']) {
    const literalEnd = start + literal.length;
    if (literalEnd <= end && text.startsWith(literal, start)
      && (literalEnd === end || !/[\w-]/.test(text[literalEnd]))) {
      return literal.length;
    }
  }
  return 0;
}

function isAsciiDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9';
}

function isJsonErrorCode(key: string | undefined, value: number): boolean {
  if (!key || !Number.isFinite(value)) return false;
  const normalizedKey = key.replace(/[-_]/g, '');
  if (normalizedKey === 'errcode' || normalizedKey === 'errorcode') return value !== 0;
  return (normalizedKey === 'code' || normalizedKey === 'status' || normalizedKey === 'statuscode'
    || normalizedKey === 'httpstatus' || normalizedKey === 'httpstatuscode') && value >= 400;
}

function isJsonFailureLiteral(key: string | undefined, value: string): boolean {
  if (!key) return false;
  const normalizedKey = key.replace(/[-_]/g, '');
  return (normalizedKey === 'success' || normalizedKey === 'ok') && value === 'false';
}

function isJsonErrorMessageKey(key: string | undefined): boolean {
  if (!key) return false;
  const normalizedKey = key.replace(/[-_]/g, '');
  return normalizedKey === 'errmsg' || normalizedKey === 'errormsg'
    || normalizedKey === 'errormessage' || normalizedKey === 'error'
    || normalizedKey === 'message';
}

function findJsonStructureEnd(text: string, start: number, end = text.length): number {
  const opener = text[start];
  if (opener !== '{' && opener !== '[') return -1;
  const stack: string[] = [opener];
  let inString = false;
  let escaped = false;
  for (let index = start + 1; index < end; index += 1) {
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

function findJsonStart(text: string, from = 0, end = text.length): number {
  for (let index = from; index < end; index += 1) {
    const char = text[index];
    if (char === '"') {
      const closingQuote = findClosingJsonQuote(text, index + 1, end);
      if (closingQuote > index) {
        let next = closingQuote + 1;
        while (next < end && /\s/.test(text[next])) next += 1;
        if (next < end && text[next] === ':') return index;
        index = closingQuote;
      }
      continue;
    }
    if (char !== '{' && char !== '[') continue;
    let next = index + 1;
    while (next < end && /\s/.test(text[next])) next += 1;
    if (next >= end) continue;
    const candidate = text[next];
    if (char === '{' && (candidate === '"' || candidate === '}')) return index;
    if (char === '[' && (candidate === '"' || candidate === '{' || candidate === '[' || candidate === ']'
      || candidate === '-' || /\d/.test(candidate)
      || (next + 4 <= end && (text.startsWith('true', next) || text.startsWith('null', next)))
      || (next + 5 <= end && text.startsWith('false', next)))) return index;
  }
  return -1;
}

function findClosingJsonQuote(text: string, start: number, end = text.length): number {
  let escaped = false;
  for (let index = start; index < end; index += 1) {
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

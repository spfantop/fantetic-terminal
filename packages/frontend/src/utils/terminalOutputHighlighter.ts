import defaultTerminalHighlightRulesDocument from './defaultTerminalHighlightRules.json';

export interface TerminalHighlightRule {
  id: string;
  name: string;
  enabled: boolean;
  pattern: string;
  flags?: string;
  foreground?: string;
  background?: string;
  bold?: boolean;
  underline?: boolean;
  priority?: number;
  stopOnMatch?: boolean;
  presetId?: string;
}

export interface TerminalHighlightOptions {
  enabled: boolean;
  rules: TerminalHighlightRule[];
  maxLineLength?: number;
}

export interface TerminalHighlightPreviewSegment {
  text: string;
  foreground?: string;
  background?: string;
  bold?: boolean;
  underline?: boolean;
}

export interface TerminalOutputHighlightStream {
  write(input: string, options: TerminalHighlightOptions): string;
  flush(options: TerminalHighlightOptions): string;
  hasPending(): boolean;
  reset(): void;
}

export interface TerminalHighlightThroughputGuard {
  shouldHighlight(inputLength: number): boolean;
  setNow(now: () => number): void;
  reset(): void;
}

interface CompiledTerminalHighlightRule {
  rule: TerminalHighlightRule;
  regex: RegExp;
  ansiStart: string;
}

interface HighlightRange {
  start: number;
  end: number;
  ansiStart: string;
  rule: TerminalHighlightRule;
}

interface TerminalEscapeSequence {
  value: string;
  end: number;
  sgrCodes?: number[];
}

interface SgrStyleState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  foreground: boolean;
  background: boolean;
  other: boolean;
}

interface CompiledTerminalHighlightRuleCacheEntry {
  signature: string;
  rules: CompiledTerminalHighlightRule[];
}

const ANSI_RESET = '\x1b[0m';
const DEFAULT_MAX_LINE_LENGTH = 4000;
const MAX_HIGHLIGHT_RANGES_PER_LINE = 256;
const MAX_PATTERN_LENGTH = 1024;
const VALID_FLAG_PATTERN = /^[gimsuy]*$/;
const CONTROL_SEQUENCE_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const compiledTerminalHighlightRulesCache = new WeakMap<TerminalHighlightRule[], CompiledTerminalHighlightRuleCacheEntry>();

const DEFAULT_TERMINAL_HIGHLIGHT_RULES_DOCUMENT = defaultTerminalHighlightRulesDocument as { rules: TerminalHighlightRule[] };

export const DEFAULT_TERMINAL_HIGHLIGHT_RULES: TerminalHighlightRule[] = normalizeTerminalHighlightRules(
  DEFAULT_TERMINAL_HIGHLIGHT_RULES_DOCUMENT.rules,
);

export const DEFAULT_TERMINAL_HIGHLIGHT_RULES_JSON = JSON.stringify(DEFAULT_TERMINAL_HIGHLIGHT_RULES_DOCUMENT);

export function cloneDefaultTerminalHighlightRules(): TerminalHighlightRule[] {
  return DEFAULT_TERMINAL_HIGHLIGHT_RULES.map(rule => ({ ...rule }));
}

export function parseTerminalHighlightRules(value?: string | null): TerminalHighlightRule[] {
  if (!value || !value.trim()) {
    return cloneDefaultTerminalHighlightRules();
  }

  try {
    const parsed = JSON.parse(value);
    const rules = Array.isArray(parsed)
      ? parsed
      : extractTerminalHighlightRulesFromDocument(parsed);
    if (!Array.isArray(rules)) {
      return cloneDefaultTerminalHighlightRules();
    }
    return normalizeTerminalHighlightRules(rules);
  } catch {
    return cloneDefaultTerminalHighlightRules();
  }
}

export function parseTerminalHighlightRulesDocument(value: string): TerminalHighlightRule[] {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error('Expected valid JSON.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmedValue);
  } catch {
    throw new Error('Expected valid JSON.');
  }

  const rules = Array.isArray(parsed)
    ? parsed
    : extractTerminalHighlightRulesFromDocument(parsed);

  if (!Array.isArray(rules)) {
    throw new Error('Terminal highlight JSON must be an array or an object with a rules array.');
  }

  return normalizeTerminalHighlightRules(rules);
}

export function serializeTerminalHighlightRules(rules: TerminalHighlightRule[]): string {
  return JSON.stringify(normalizeTerminalHighlightRules(rules));
}

export function normalizeTerminalHighlightRules(value: unknown): TerminalHighlightRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index): TerminalHighlightRule | null => {
      if (!item || typeof item !== 'object') return null;
      const source = item as Partial<TerminalHighlightRule>;
      const pattern = typeof source.pattern === 'string' ? source.pattern.trim() : '';
      if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return null;

      return {
        id: normalizeRuleId(source.id, index),
        name: normalizeRuleName(source.name, index),
        enabled: source.enabled !== false,
        pattern,
        flags: sanitizeRegexFlags(source.flags),
        foreground: normalizeColor(source.foreground),
        background: normalizeColor(source.background),
        bold: source.bold === true,
        underline: source.underline === true,
        priority: normalizePriority(source.priority),
        stopOnMatch: source.stopOnMatch === true,
        presetId: typeof source.presetId === 'string' ? source.presetId : undefined,
      };
    })
    .filter((rule): rule is TerminalHighlightRule => rule !== null);
}

export function highlightTerminalOutput(input: string, options: TerminalHighlightOptions): string {
  if (!options.enabled || input.length === 0) {
    return input;
  }

  const compiledRules = compileTerminalHighlightRules(options.rules);
  if (compiledRules.length === 0) {
    return input;
  }

  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  return input
    .split(/(\r\n|\n|\r)/)
    .map(part => {
      if (part === '\r\n' || part === '\n' || part === '\r') return part;
      if (part.length === 0 || part.length > maxLineLength) return part;
      return highlightLinePreservingTerminalSequences(part, compiledRules);
    })
    .join('');
}

export function createTerminalOutputHighlightStream(): TerminalOutputHighlightStream {
  let pendingLineFragment = '';

  return {
    write(input: string, options: TerminalHighlightOptions): string {
      if (input.length === 0) {
        return '';
      }

      if (!shouldStreamHighlight(options)) {
        const output = pendingLineFragment + input;
        pendingLineFragment = '';
        return output;
      }

      const combinedInput = pendingLineFragment + input;
      const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
      const completeEnd = findLastCompleteLineBreakEnd(combinedInput);

      if (completeEnd === 0) {
        const { stablePrefix, activeTail } = splitTerminalControlTailForStreaming(combinedInput);
        if (activeTail.length > maxLineLength) {
          pendingLineFragment = '';
          return highlightTerminalOutput(stablePrefix + activeTail, options);
        }

        pendingLineFragment = activeTail;
        return stablePrefix ? highlightTerminalOutput(stablePrefix, options) : '';
      }

      const completeText = combinedInput.slice(0, completeEnd);
      const incompleteLine = combinedInput.slice(completeEnd);

      const { stablePrefix, activeTail } = splitTerminalControlTailForStreaming(incompleteLine);
      pendingLineFragment = activeTail;
      let output = highlightTerminalOutput(completeText, options);
      if (stablePrefix) {
        output += highlightTerminalOutput(stablePrefix, options);
      }

      if (pendingLineFragment.length > maxLineLength) {
        output += highlightTerminalOutput(pendingLineFragment, options);
        pendingLineFragment = '';
      }

      return output;
    },

    flush(options: TerminalHighlightOptions): string {
      if (!pendingLineFragment) {
        return '';
      }

      const output = shouldStreamHighlight(options)
        ? highlightTerminalOutput(pendingLineFragment, options)
        : pendingLineFragment;
      pendingLineFragment = '';
      return output;
    },

    hasPending(): boolean {
      return pendingLineFragment.length > 0;
    },

    reset(): void {
      pendingLineFragment = '';
    },
  };
}

export function previewTerminalHighlightSegments(input: string, options: TerminalHighlightOptions): TerminalHighlightPreviewSegment[] {
  if (!options.enabled || input.length === 0 || shouldBypassHighlight(input)) {
    return [{ text: input }];
  }

  const compiledRules = compileTerminalHighlightRules(options.rules);
  if (compiledRules.length === 0) {
    return [{ text: input }];
  }

  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  return input
    .split(/(\r\n|\n|\r)/)
    .flatMap(part => {
      if (part === '\r\n' || part === '\n' || part === '\r') return [{ text: part }];
      if (part.length === 0 || part.length > maxLineLength) return [{ text: part }];
      return previewLine(part, compiledRules);
    });
}

function shouldBypassHighlight(input: string): boolean {
  return input.includes('\x1b') || CONTROL_SEQUENCE_PATTERN.test(input);
}

function shouldStreamHighlight(options: TerminalHighlightOptions): boolean {
  return options.enabled && options.rules.length > 0;
}

function splitTerminalControlTailForStreaming(input: string): { stablePrefix: string; activeTail: string } {
  if (!input) {
    return { stablePrefix: '', activeTail: '' };
  }

  const incompleteEscapeStart = findIncompleteTerminalEscapeStart(input);
  if (incompleteEscapeStart >= 0) {
    return {
      stablePrefix: input.slice(0, incompleteEscapeStart),
      activeTail: input.slice(incompleteEscapeStart),
    };
  }

  return {
    stablePrefix: input,
    activeTail: '',
  };
}

export function createTerminalHighlightThroughputGuard(options: {
  suspendByteThreshold?: number;
  resumeAfterMs?: number;
  now?: () => number;
} = {}): TerminalHighlightThroughputGuard {
  const suspendByteThreshold = options.suspendByteThreshold ?? 96 * 1024;
  const resumeAfterMs = options.resumeAfterMs ?? 250;
  let now = options.now ?? (() => Date.now());
  let suspendedUntil = 0;

  return {
    shouldHighlight(inputLength: number): boolean {
      const currentTime = now();
      if (currentTime < suspendedUntil) return false;
      if (inputLength > suspendByteThreshold) {
        suspendedUntil = currentTime + resumeAfterMs;
        return false;
      }
      return true;
    },

    setNow(nextNow: () => number): void {
      now = nextNow;
    },

    reset(): void {
      suspendedUntil = 0;
    },
  };
}

function findIncompleteTerminalEscapeStart(input: string): number {
  const escapeStart = input.lastIndexOf('\x1b');
  if (escapeStart < 0) return -1;

  return readTerminalEscapeSequence(input, escapeStart) ? -1 : escapeStart;
}

function findLastCompleteLineBreakEnd(input: string): number {
  for (let offset = input.length - 1; offset >= 0; offset -= 1) {
    const char = input[offset];
    if (char === '\n') {
      return offset + 1;
    }

    if (char === '\r' && offset < input.length - 1) {
      return input[offset + 1] === '\n' ? offset + 2 : offset + 1;
    }
  }

  return 0;
}

function extractTerminalHighlightRulesFromDocument(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const document = value as { rules?: unknown };
  return document.rules;
}

function compileTerminalHighlightRules(rules: TerminalHighlightRule[]): CompiledTerminalHighlightRule[] {
  const signature = createTerminalHighlightRulesSignature(rules);
  const cached = compiledTerminalHighlightRulesCache.get(rules);
  if (cached?.signature === signature) {
    return cached.rules;
  }

  const compiledRules = normalizeTerminalHighlightRules(rules)
    .filter(rule => rule.enabled && (rule.foreground || rule.background || rule.bold || rule.underline))
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
    .map(rule => {
      const regex = createRuleRegex(rule);
      const ansiStart = createAnsiStart(rule);
      return regex && ansiStart ? { rule, regex, ansiStart } : null;
    })
    .filter((rule): rule is CompiledTerminalHighlightRule => rule !== null);

  compiledTerminalHighlightRulesCache.set(rules, { signature, rules: compiledRules });
  return compiledRules;
}

function highlightLinePreservingTerminalSequences(line: string, rules: CompiledTerminalHighlightRule[]): string {
  if (!line.includes('\x1b')) {
    return CONTROL_SEQUENCE_PATTERN.test(line) ? line : highlightLine(line, rules);
  }

  let output = '';
  let textBuffer = '';
  let offset = 0;
  let sgrState = createEmptySgrStyleState();

  const flushTextBuffer = () => {
    if (!textBuffer) return;
    output += hasActiveSgrStyle(sgrState) ? textBuffer : highlightLine(textBuffer, rules);
    textBuffer = '';
  };

  while (offset < line.length) {
    const char = line[offset];
    if (char !== '\x1b') {
      if (CONTROL_SEQUENCE_PATTERN.test(char)) {
        return line;
      }
      textBuffer += char;
      offset += 1;
      continue;
    }

    const escapeSequence = readTerminalEscapeSequence(line, offset);
    if (!escapeSequence) {
      return line;
    }

    flushTextBuffer();
    output += escapeSequence.value;
    if (escapeSequence.sgrCodes) {
      sgrState = applySgrCodes(sgrState, escapeSequence.sgrCodes);
    }
    offset = escapeSequence.end;
  }

  flushTextBuffer();
  return output;
}

function createTerminalHighlightRulesSignature(rules: TerminalHighlightRule[]): string {
  return rules
    .map(rule => [
      rule.id,
      rule.name,
      rule.enabled,
      rule.pattern,
      rule.flags,
      rule.foreground,
      rule.background,
      rule.bold,
      rule.underline,
      rule.priority,
      rule.stopOnMatch,
      rule.presetId,
    ].join('\u001f'))
    .join('\u001e');
}

function highlightLine(line: string, rules: CompiledTerminalHighlightRule[]): string {
  const ranges = collectHighlightRanges(line, rules);

  if (ranges.length === 0) {
    return line;
  }

  let output = '';
  let offset = 0;
  for (const range of ranges) {
    output += line.slice(offset, range.start);
    output += `${range.ansiStart}${line.slice(range.start, range.end)}${ANSI_RESET}`;
    offset = range.end;
  }
  output += line.slice(offset);
  return output;
}

function previewLine(line: string, rules: CompiledTerminalHighlightRule[]): TerminalHighlightPreviewSegment[] {
  const ranges = collectHighlightRanges(line, rules);
  if (ranges.length === 0) {
    return [{ text: line }];
  }

  const segments: TerminalHighlightPreviewSegment[] = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start > offset) {
      segments.push({ text: line.slice(offset, range.start) });
    }
    segments.push({
      text: line.slice(range.start, range.end),
      foreground: range.rule.foreground,
      background: range.rule.background,
      bold: range.rule.bold,
      underline: range.rule.underline,
    });
    offset = range.end;
  }
  if (offset < line.length) {
    segments.push({ text: line.slice(offset) });
  }
  return segments;
}

function collectHighlightRanges(line: string, rules: CompiledTerminalHighlightRule[]): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  for (const compiled of rules) {
    let matchedCurrentRule = false;
    compiled.regex.lastIndex = 0;

    for (const match of line.matchAll(compiled.regex)) {
      const matchText = match[0];
      if (!matchText) continue;

      const start = match.index ?? 0;
      const end = start + matchText.length;
      if (ranges.some(range => start < range.end && end > range.start)) {
        continue;
      }

      ranges.push({ start, end, ansiStart: compiled.ansiStart, rule: compiled.rule });
      matchedCurrentRule = true;
      if (ranges.length >= MAX_HIGHLIGHT_RANGES_PER_LINE) {
        break;
      }
    }

    if (matchedCurrentRule && compiled.rule.stopOnMatch) {
      break;
    }
    if (ranges.length >= MAX_HIGHLIGHT_RANGES_PER_LINE) {
      break;
    }
  }

  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  return ranges;
}

function createEmptySgrStyleState(): SgrStyleState {
  return {
    bold: false,
    italic: false,
    underline: false,
    foreground: false,
    background: false,
    other: false,
  };
}

function hasActiveSgrStyle(state: SgrStyleState): boolean {
  return state.bold || state.italic || state.underline || state.foreground || state.background || state.other;
}

function readTerminalEscapeSequence(input: string, start: number): TerminalEscapeSequence | null {
  const next = input[start + 1];
  if (!next) {
    return null;
  }

  if (next === '[') {
    return readCsiSequence(input, start);
  }

  if (next === ']') {
    return readStringEscapeSequence(input, start);
  }

  if (next === 'P' || next === '_' || next === '^' || next === 'X') {
    return readStringEscapeSequence(input, start);
  }

  return {
    value: input.slice(start, start + 2),
    end: start + 2,
  };
}

function readCsiSequence(input: string, start: number): TerminalEscapeSequence | null {
  for (let offset = start + 2; offset < input.length; offset += 1) {
    const code = input.charCodeAt(offset);
    if (code < 0x40 || code > 0x7e) {
      continue;
    }

    const value = input.slice(start, offset + 1);
    const finalByte = input[offset];
    return {
      value,
      end: offset + 1,
      sgrCodes: finalByte === 'm' ? parseSgrCodes(input.slice(start + 2, offset)) : undefined,
    };
  }

  return null;
}

function readStringEscapeSequence(input: string, start: number): TerminalEscapeSequence | null {
  for (let offset = start + 2; offset < input.length; offset += 1) {
    if (input[offset] === '\x07') {
      return {
        value: input.slice(start, offset + 1),
        end: offset + 1,
      };
    }

    if (input[offset] === '\x1b' && input[offset + 1] === '\\') {
      return {
        value: input.slice(start, offset + 2),
        end: offset + 2,
      };
    }
  }

  return null;
}

function parseSgrCodes(value: string): number[] {
  if (!value.trim()) {
    return [0];
  }

  return value
    .split(';')
    .map(part => {
      const normalized = part.trim();
      return normalized === '' ? 0 : Number(normalized);
    })
    .filter(code => Number.isFinite(code))
    .map(code => Math.trunc(code));
}

function applySgrCodes(currentState: SgrStyleState, codes: number[]): SgrStyleState {
  const nextState = { ...currentState };
  for (const code of codes) {
    if (code === 0) {
      Object.assign(nextState, createEmptySgrStyleState());
      continue;
    }

    if (code === 1 || code === 2) nextState.bold = true;
    if (code === 3) nextState.italic = true;
    if (code === 4) nextState.underline = true;
    if (code === 5 || code === 7 || code === 8 || code === 9) nextState.other = true;
    if (code === 22) nextState.bold = false;
    if (code === 23) nextState.italic = false;
    if (code === 24) nextState.underline = false;
    if (code === 25 || code === 27 || code === 28 || code === 29) nextState.other = false;
    if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97) || code === 38) nextState.foreground = true;
    if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107) || code === 48) nextState.background = true;
    if (code === 39) nextState.foreground = false;
    if (code === 49) nextState.background = false;
  }
  return nextState;
}

function createRuleRegex(rule: TerminalHighlightRule): RegExp | null {
  try {
    return new RegExp(rule.pattern, ensureGlobalFlag(rule.flags));
  } catch {
    return null;
  }
}

function ensureGlobalFlag(flags?: string): string {
  const sanitized = sanitizeRegexFlags(flags);
  return sanitized.includes('g') ? sanitized : `${sanitized}g`;
}

function sanitizeRegexFlags(flags?: string): string {
  if (!flags || !VALID_FLAG_PATTERN.test(flags)) {
    return 'g';
  }

  return Array.from(new Set(flags.split(''))).join('');
}

function createAnsiStart(rule: TerminalHighlightRule): string {
  const codes: string[] = [];
  if (rule.bold) codes.push('1');
  if (rule.underline) codes.push('4');
  const foreground = parseHexColor(rule.foreground);
  if (foreground) codes.push(`38;2;${foreground.r};${foreground.g};${foreground.b}`);
  const background = parseHexColor(rule.background);
  if (background) codes.push(`48;2;${background.r};${background.g};${background.b}`);
  return codes.length > 0 ? `\x1b[${codes.join(';')}m` : '';
}

function parseHexColor(color?: string) {
  const normalized = normalizeColor(color);
  if (!normalized) return null;

  const value = normalized.length === 4
    ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
    : normalized;

  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  };
}

function normalizeColor(color?: string): string | undefined {
  if (typeof color !== 'string') return undefined;
  const trimmed = color.trim();
  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed : undefined;
}

function normalizeRuleId(id: unknown, index: number): string {
  if (typeof id === 'string' && id.trim()) {
    return id.trim().slice(0, 64);
  }
  return `rule-${index + 1}`;
}

function normalizeRuleName(name: unknown, index: number): string {
  if (typeof name === 'string' && name.trim()) {
    return name.trim().slice(0, 80);
  }
  return `rule-${index + 1}`;
}

function normalizePriority(priority: unknown): number {
  const numericPriority = Number(priority);
  if (!Number.isFinite(numericPriority)) {
    return 0;
  }
  return Math.max(-1000, Math.min(1000, Math.trunc(numericPriority)));
}

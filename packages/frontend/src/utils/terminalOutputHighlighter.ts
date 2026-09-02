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

export interface TerminalHighlightContrastSummary {
  totalRuleCount: number;
  failingRuleCount: number;
  customFailingRuleCount: number;
  minimumContrastRatio: number;
}

export interface TerminalHighlightPreviewSegment {
  text: string;
  foreground?: string;
  background?: string;
  bold?: boolean;
  underline?: boolean;
}

/**
 * A semantic match in a single terminal buffer line.  Unlike
 * `highlightTerminalOutput`, this deliberately carries no ANSI escape data:
 * the renderer consumes it as presentation metadata and the PTY payload stays
 * byte-for-byte intact.
 */
export interface TerminalHighlightRange {
  start: number;
  end: number;
  foreground?: string;
  background?: string;
  bold?: boolean;
  underline?: boolean;
}

export type TerminalHighlightRangeResolver = (line: string) => TerminalHighlightRange[];

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
const MINIMUM_TEXT_CONTRAST_RATIO = 4.5;
const CONTRAST_QUANTIZATION_MARGIN = 0.05;
const compiledTerminalHighlightRulesCache = new WeakMap<TerminalHighlightRule[], CompiledTerminalHighlightRuleCacheEntry>();

const DEFAULT_TERMINAL_HIGHLIGHT_RULES_DOCUMENT = defaultTerminalHighlightRulesDocument as { rules: TerminalHighlightRule[] };

export const DEFAULT_TERMINAL_HIGHLIGHT_RULES: TerminalHighlightRule[] = normalizeTerminalHighlightRules(
  DEFAULT_TERMINAL_HIGHLIGHT_RULES_DOCUMENT.rules,
);

const DEFAULT_TERMINAL_HIGHLIGHT_RULES_BY_ID = new Map(
  DEFAULT_TERMINAL_HIGHLIGHT_RULES.map(rule => [rule.id, rule]),
);

type TerminalHighlightSemanticRole =
  | 'critical'
  | 'warning'
  | 'success'
  | 'info'
  | 'muted'
  | 'timestamp'
  | 'context'
  | 'source'
  | 'network'
  | 'identity'
  | 'command'
  | 'syntax'
  | 'string'
  | 'value'
  | 'key'
  | 'literal'
  | 'punctuation'
  | 'structure';

const TERMINAL_HIGHLIGHT_ROLE_BY_PRESET_ID: Readonly<Record<string, TerminalHighlightSemanticRole>> = {
  fatal: 'critical', error: 'critical', exceptionWord: 'critical', httpStatusError: 'critical',
  javaException: 'critical', causedBy: 'critical', sqlDanger: 'critical',
  warning: 'warning', httpStatusRedirect: 'warning',
  success: 'success', httpStatusOk: 'success',
  info: 'info', httpMethod: 'info',
  debug: 'muted', commentLine: 'muted', hash: 'muted',
  timestampIso: 'timestamp', timestampSlash: 'timestamp', timestampChinese: 'timestamp',
  dateOnly: 'timestamp', timeOnly: 'timestamp',
  javaThread: 'context',
  linuxPath: 'source', windowsPath: 'source', fileLine: 'source', configFile: 'source',
  url: 'network', ipv4Port: 'network', ipv4: 'network', ipv6: 'network', domain: 'network',
  rootPrompt: 'identity', userHostPrompt: 'identity', promptPath: 'identity',
  shellPromptSymbol: 'identity', gitBranchPrompt: 'identity', traceId: 'identity', uuid: 'identity',
  commonCommand: 'command', devopsCommand: 'command', gitSubcommand: 'command',
  dockerSubcommand: 'command', kubectlWord: 'command', sqlKeyword: 'command',
  longOption: 'syntax', shortOption: 'syntax', envAssignment: 'syntax', shellVariable: 'syntax', operator: 'syntax',
  doubleQuotedString: 'string', singleQuotedString: 'string', jsonString: 'string',
  size: 'value', duration: 'value', percent: 'value', number: 'value', jsonNumber: 'value',
  jsonKey: 'key', jsonLiteral: 'literal', jsonPunctuation: 'punctuation',
  stackTrace: 'structure', jsonBoundary: 'structure',
};

const DARK_TERMINAL_HIGHLIGHT_PALETTE: Readonly<Record<TerminalHighlightSemanticRole, string>> = {
  critical: '#FF8080',
  warning: '#F5C451',
  success: '#5FE08B',
  info: '#6CCFF6',
  muted: '#A8B3CF',
  timestamp: '#9AA7B8',
  context: '#A8B3CF',
  source: '#F0DF86',
  network: '#82D2FF',
  identity: '#82D2FF',
  command: '#F0DF86',
  syntax: '#7FE0C3',
  string: '#F1AD8D',
  value: '#B8E58E',
  key: '#82D2FF',
  literal: '#D6A8E5',
  punctuation: '#A8B3CF',
  structure: '#D6A8E5',
};

const LIGHT_TERMINAL_HIGHLIGHT_PALETTE: Readonly<Record<TerminalHighlightSemanticRole, string>> = {
  critical: '#B42318',
  warning: '#7A4A00',
  success: '#087A43',
  info: '#006A85',
  muted: '#4B5563',
  timestamp: '#536171',
  context: '#4B5563',
  source: '#5B4B00',
  network: '#005EA8',
  identity: '#005EA8',
  command: '#5B4B00',
  syntax: '#006B57',
  string: '#8A3D1F',
  value: '#3C6E13',
  key: '#005EA8',
  literal: '#6B3FA0',
  punctuation: '#4B5563',
  structure: '#6B3FA0',
};
type LegacyTerminalHighlightRuleDefaults = Partial<Pick<
  TerminalHighlightRule,
  'enabled' | 'pattern' | 'flags' | 'foreground' | 'background'
  | 'bold' | 'underline' | 'priority' | 'stopOnMatch'
>>;

const LEGACY_TERMINAL_HIGHLIGHT_RULE_DEFAULTS: Readonly<Record<
  string,
  readonly LegacyTerminalHighlightRuleDefaults[]
>> = {
  'preset-success': [{
    pattern: '\\b(SUCCESS|SUCCEEDED|PASS(?:ED)?|OK|DONE|READY|STARTED|RUNNING|UP|COMPLETED)\\b',
    flags: 'gi',
  }],
  'preset-prompt-path': [{
    pattern: '(?<=:)(?:~|/)[A-Za-z0-9._~:@%+\\-\\/]*(?=\\s|[$#❯➜])',
    priority: 153,
  }],
  'preset-common-command': [{ flags: 'gi' }],
  'preset-git-subcommand': [{ enabled: true }],
  'preset-docker-subcommand': [{ enabled: true }],
  'preset-kubectl-word': [{ enabled: true }],
  'preset-double-quoted-string': [{ enabled: true }],
  'preset-single-quoted-string': [{ enabled: true }],
  'preset-file-line': [{ foreground: '#FFD866', underline: true }],
  'preset-ipv6': [{
    pattern: '\\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\\b',
    priority: 110,
  }],
  'preset-stacktrace': [{
    pattern: '^\\s*at\\s+(?:[a-zA-Z_$][\\w$]*\\.)+[A-Za-z_$][\\w$]*\\([^)]*\\)',
    priority: 129,
  }],
  'preset-caused-by': [{
    pattern: '^\\s*Caused by:\\s+.*$',
    priority: 130,
  }],
  'preset-sql-danger': [{ flags: 'gi' }],
  'preset-sql-keyword': [{ flags: 'gi' }],
};

interface LegacyJsonPresetDefaults {
  id: string;
  name: string;
  pattern: string;
  flags: string;
  priority: number;
  presetId: string;
}

const LEGACY_JSON_PRESET_DEFAULTS: readonly LegacyJsonPresetDefaults[] = [
  {
    id: 'preset-json-inline-object',
    name: 'jsonInlineObject',
    pattern: '\\{(?:[^{}\\"\\\\]+|\\\\.|\\"(?:\\\\.|[^\\"\\\\])*\\"|\\[(?:[^\\[\\]\\"\\\\]+|\\\\.|\\"(?:\\\\.|[^\\"\\\\])*\\")*\\]|\\{(?:[^{}\\"\\\\]+|\\\\.|\\"(?:\\\\.|[^\\"\\\\])*\\")*\\})*\\}',
    flags: 'g',
    priority: 240,
    presetId: 'jsonInlineObject',
  },
  {
    id: 'preset-json-inline-array',
    name: 'jsonInlineArray',
    pattern: '\\[(?:[^\\[\\]{}\\"\\\\]+|\\\\.|\\"(?:\\\\.|[^\\"\\\\])*\\"|\\{(?:[^{}\\"\\\\]+|\\\\.|\\"(?:\\\\.|[^\\"\\\\])*\\")*\\})*\\]',
    flags: 'g',
    priority: 239,
    presetId: 'jsonInlineArray',
  },
  {
    id: 'preset-json-pretty-key-value-line',
    name: 'jsonPrettyKeyValueLine',
    pattern: '^\\s*\\"(?:\\\\.|[^\\"\\\\])+\\"\\s*:\\s*(?:\\"(?:\\\\.|[^\\"\\\\])*\\"|[-+]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|true|false|null|\\{.*\\}|\\[.*\\])\\s*,?\\s*$',
    flags: 'gim',
    priority: 238,
    presetId: 'jsonPrettyKeyValueLine',
  },
  {
    id: 'preset-json-pretty-bracket-line',
    name: 'jsonPrettyBracketLine',
    pattern: '^\\s*[\\{\\}\\[\\]],?\\s*$',
    flags: 'gm',
    priority: 237,
    presetId: 'jsonPrettyBracketLine',
  },
];

const SEMANTIC_JSON_PRESET_IDS = new Set([
  'preset-json-boundary',
  'preset-json-key',
  'preset-json-string',
  'preset-json-number',
  'preset-json-literal',
  'preset-json-punctuation',
]);

export const DEFAULT_TERMINAL_HIGHLIGHT_RULES_JSON = JSON.stringify(DEFAULT_TERMINAL_HIGHLIGHT_RULES_DOCUMENT);

export function cloneDefaultTerminalHighlightRules(): TerminalHighlightRule[] {
  return DEFAULT_TERMINAL_HIGHLIGHT_RULES.map(rule => ({ ...rule }));
}

export function resolveTerminalHighlightRulesForTheme(
  rules: TerminalHighlightRule[],
  terminalBackground?: string,
): TerminalHighlightRule[] {
  const background = parseRgbHexColor(terminalBackground) ?? parseRgbHexColor('#1e1e1e')!;
  const palette = relativeLuminance(background) > 0.45
    ? LIGHT_TERMINAL_HIGHLIGHT_PALETTE
    : DARK_TERMINAL_HIGHLIGHT_PALETTE;

  return rules.map(rule => {
    const semanticRole = getTerminalHighlightSemanticRole(rule);
    if (!semanticRole || !isTerminalHighlightRuleUsingDefaultColor(rule)) return rule;
    return {
      ...rule,
      foreground: ensureMinimumContrast(palette[semanticRole], background),
    };
  });
}

export function getTerminalHighlightContrastSummary(
  rules: TerminalHighlightRule[],
  terminalBackground?: string,
): TerminalHighlightContrastSummary {
  const fallbackBackground = parseRgbHexColor(terminalBackground) ?? parseRgbHexColor('#1e1e1e')!;
  let totalRuleCount = 0;
  let failingRuleCount = 0;
  let customFailingRuleCount = 0;
  let minimumContrastRatio = Number.POSITIVE_INFINITY;

  for (const rule of rules) {
    if (!rule.enabled || !rule.foreground) continue;
    const foreground = parseRgbHexColor(rule.foreground);
    const background = parseRgbHexColor(rule.background) ?? fallbackBackground;
    if (!foreground) continue;
    totalRuleCount += 1;
    const contrastRatio = calculateContrastRatio(foreground, background);
    minimumContrastRatio = Math.min(minimumContrastRatio, contrastRatio);
    if (contrastRatio >= MINIMUM_TEXT_CONTRAST_RATIO) continue;
    failingRuleCount += 1;
    if (!isThemeManagedTerminalHighlightRule(rule, fallbackBackground)) {
      customFailingRuleCount += 1;
    }
  }

  return {
    totalRuleCount,
    failingRuleCount,
    customFailingRuleCount,
    minimumContrastRatio: Number.isFinite(minimumContrastRatio) ? minimumContrastRatio : 0,
  };
}

function getTerminalHighlightSemanticRole(rule: TerminalHighlightRule): TerminalHighlightSemanticRole | undefined {
  return rule.presetId ? TERMINAL_HIGHLIGHT_ROLE_BY_PRESET_ID[rule.presetId] : undefined;
}

function isTerminalHighlightRuleUsingDefaultColor(rule: TerminalHighlightRule): boolean {
  const defaultRule = DEFAULT_TERMINAL_HIGHLIGHT_RULES_BY_ID.get(rule.id);
  return Boolean(
    defaultRule?.presetId
    && rule.presetId === defaultRule.presetId
    && normalizeComparableColor(rule.foreground) === normalizeComparableColor(defaultRule.foreground),
  );
}

function isThemeManagedTerminalHighlightRule(rule: TerminalHighlightRule, background: RgbColor): boolean {
  if (isTerminalHighlightRuleUsingDefaultColor(rule)) return true;
  const semanticRole = getTerminalHighlightSemanticRole(rule);
  if (!semanticRole) return false;
  const palette = relativeLuminance(background) > 0.45
    ? LIGHT_TERMINAL_HIGHLIGHT_PALETTE
    : DARK_TERMINAL_HIGHLIGHT_PALETTE;
  return normalizeComparableColor(rule.foreground) === normalizeComparableColor(
    ensureMinimumContrast(palette[semanticRole], background),
  );
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

function normalizeComparableColor(value?: string): string | undefined {
  const color = parseRgbHexColor(value);
  return color ? rgbToHex(color) : undefined;
}

function parseRgbHexColor(value?: string): RgbColor | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value?.trim() ?? '');
  if (!match) return undefined;
  const hex = match[1].length === 3
    ? match[1].split('').map(character => character + character).join('')
    : match[1];
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex(color: RgbColor): string {
  const channel = (value: number) => Math.round(value).toString(16).padStart(2, '0').toUpperCase();
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

function relativeLuminance(color: RgbColor): number {
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (0.2126 * linearize(color.red))
    + (0.7152 * linearize(color.green))
    + (0.0722 * linearize(color.blue));
}

function calculateContrastRatio(left: RgbColor, right: RgbColor): number {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function ensureMinimumContrast(foregroundValue: string, background: RgbColor): string {
  const foreground = parseRgbHexColor(foregroundValue)!;
  if (calculateContrastRatio(foreground, background) >= MINIMUM_TEXT_CONTRAST_RATIO) {
    return rgbToHex(foreground);
  }

  const black = parseRgbHexColor('#000000')!;
  const white = parseRgbHexColor('#ffffff')!;
  const target = calculateContrastRatio(black, background) > calculateContrastRatio(white, background)
    ? black
    : white;
  const adjustmentTarget = MINIMUM_TEXT_CONTRAST_RATIO + CONTRAST_QUANTIZATION_MARGIN;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const amount = (low + high) / 2;
    const candidate = mixRgbColors(foreground, target, amount);
    if (calculateContrastRatio(candidate, background) >= adjustmentTarget) high = amount;
    else low = amount;
  }
  return rgbToHex(mixRgbColors(foreground, target, high));
}

function mixRgbColors(source: RgbColor, target: RgbColor, amount: number): RgbColor {
  return {
    red: source.red + (target.red - source.red) * amount,
    green: source.green + (target.green - source.green) * amount,
    blue: source.blue + (target.blue - source.blue) * amount,
  };
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
    return migrateLegacyTerminalHighlightRuleDefaults(normalizeTerminalHighlightRules(rules));
  } catch {
    return cloneDefaultTerminalHighlightRules();
  }
}

function migrateLegacyTerminalHighlightRuleDefaults(rules: TerminalHighlightRule[]): TerminalHighlightRule[] {
  const migratedRules = rules.map(rule => {
    const currentDefaults = DEFAULT_TERMINAL_HIGHLIGHT_RULES_BY_ID.get(rule.id);
    const legacyDefaultList = LEGACY_TERMINAL_HIGHLIGHT_RULE_DEFAULTS[rule.id];
    if (!currentDefaults || !legacyDefaultList) return rule;

    return legacyDefaultList.reduce<TerminalHighlightRule>((migratedRule, legacyDefaults) => {
      const matchesLegacyDefaults = (
        migratedRule.pattern === (legacyDefaults.pattern ?? currentDefaults.pattern)
        && (legacyDefaults.enabled === undefined || migratedRule.enabled === legacyDefaults.enabled)
        && (legacyDefaults.flags === undefined || migratedRule.flags === legacyDefaults.flags)
        && (legacyDefaults.foreground === undefined || migratedRule.foreground === legacyDefaults.foreground)
        && (legacyDefaults.background === undefined || migratedRule.background === legacyDefaults.background)
        && (legacyDefaults.bold === undefined || migratedRule.bold === legacyDefaults.bold)
        && (legacyDefaults.underline === undefined || migratedRule.underline === legacyDefaults.underline)
        && (legacyDefaults.priority === undefined || migratedRule.priority === legacyDefaults.priority)
        && (legacyDefaults.stopOnMatch === undefined || migratedRule.stopOnMatch === legacyDefaults.stopOnMatch)
      );
      if (!matchesLegacyDefaults) return migratedRule;

      return {
        ...migratedRule,
        enabled: legacyDefaults.enabled === undefined ? migratedRule.enabled : currentDefaults.enabled,
        pattern: legacyDefaults.pattern === undefined ? migratedRule.pattern : currentDefaults.pattern,
        flags: legacyDefaults.flags === undefined ? migratedRule.flags : currentDefaults.flags,
        foreground: legacyDefaults.foreground === undefined ? migratedRule.foreground : currentDefaults.foreground,
        background: legacyDefaults.background === undefined ? migratedRule.background : currentDefaults.background,
        bold: legacyDefaults.bold === undefined ? migratedRule.bold : currentDefaults.bold,
        underline: legacyDefaults.underline === undefined ? migratedRule.underline : currentDefaults.underline,
        priority: legacyDefaults.priority === undefined ? migratedRule.priority : currentDefaults.priority,
        stopOnMatch: legacyDefaults.stopOnMatch === undefined
          ? migratedRule.stopOnMatch
          : currentDefaults.stopOnMatch,
      };
    }, rule);
  });
  return migrateLegacyJsonPresetDefaults(migratedRules);
}

function migrateLegacyJsonPresetDefaults(rules: TerminalHighlightRule[]): TerminalHighlightRule[] {
  if (rules.some(rule => SEMANTIC_JSON_PRESET_IDS.has(rule.id))) return rules;

  const legacyRuleList = LEGACY_JSON_PRESET_DEFAULTS.map(defaults => (
    rules.find(rule => rule.id === defaults.id)
  ));
  const hasUntouchedLegacyDefaults = legacyRuleList.every((rule, index) => {
    const defaults = LEGACY_JSON_PRESET_DEFAULTS[index];
    return Boolean(
      rule
      && rule.name === defaults.name
      && rule.enabled
      && rule.pattern === defaults.pattern
      && rule.flags === defaults.flags
      && rule.foreground?.toUpperCase() === '#98C379'
      && rule.background === undefined
      && !rule.bold
      && !rule.underline
      && rule.priority === defaults.priority
      && !rule.stopOnMatch
      && rule.presetId === defaults.presetId
    );
  });
  if (!hasUntouchedLegacyDefaults) return rules;

  const legacyIdSet = new Set(LEGACY_JSON_PRESET_DEFAULTS.map(defaults => defaults.id));
  const firstLegacyIndex = rules.findIndex(rule => legacyIdSet.has(rule.id));
  const migratedRules = rules.filter(rule => !legacyIdSet.has(rule.id));
  const semanticJsonDefaults = DEFAULT_TERMINAL_HIGHLIGHT_RULES
    .filter(rule => SEMANTIC_JSON_PRESET_IDS.has(rule.id))
    .map(rule => ({ ...rule }));
  migratedRules.splice(firstLegacyIndex, 0, ...semanticJsonDefaults);

  if (!migratedRules.some(rule => rule.id === 'preset-java-thread')) {
    const javaThreadDefaults = DEFAULT_TERMINAL_HIGHLIGHT_RULES_BY_ID.get('preset-java-thread');
    const timeRuleIndex = migratedRules.findIndex(rule => rule.id === 'preset-time-only');
    if (javaThreadDefaults) migratedRules.splice(timeRuleIndex + 1, 0, { ...javaThreadDefaults });
  }
  return migratedRules;
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

/**
 * Resolve styles for one already-parsed terminal line.  This is used by the
 * xterm render bridge; it must never be used to rewrite terminal output.
 */
export function resolveTerminalHighlightRanges(line: string, options: TerminalHighlightOptions): TerminalHighlightRange[] {
  if (!options.enabled || !line || line.length > (options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH) || shouldBypassHighlight(line)) {
    return [];
  }

  const compiledRules = compileTerminalHighlightRules(options.rules);
  if (compiledRules.length === 0) {
    return [];
  }

  return collectHighlightRanges(line, compiledRules).map(range => ({
    start: range.start,
    end: range.end,
    foreground: range.rule.foreground,
    background: range.rule.background,
    bold: range.rule.bold,
    underline: range.rule.underline,
  }));
}

/**
 * Compile a rule set once for the renderer hot path.  Buffer rows are resolved
 * many times while scrolling/resizing, so rule normalization and RegExp
 * construction must not be repeated from createRow.
 */
export function createTerminalHighlightRangeResolver(options: TerminalHighlightOptions): TerminalHighlightRangeResolver {
  if (!options.enabled) return () => [];
  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  const compiledRules = compileTerminalHighlightRules(options.rules);
  if (compiledRules.length === 0) return () => [];

  return (line: string) => {
    if (!line || line.length > maxLineLength || shouldBypassHighlight(line)) return [];
    return collectHighlightRanges(line, compiledRules).map(range => ({
      start: range.start,
      end: range.end,
      foreground: range.rule.foreground,
      background: range.rule.background,
      bold: range.rule.bold,
      underline: range.rule.underline,
    }));
  };
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
      const insertionIndex = findHighlightRangeInsertionIndex(ranges, start);
      const previousRange = ranges[insertionIndex - 1];
      const nextRange = ranges[insertionIndex];
      if ((previousRange && start < previousRange.end) || (nextRange && end > nextRange.start)) {
        continue;
      }

      ranges.splice(insertionIndex, 0, { start, end, ansiStart: compiled.ansiStart, rule: compiled.rule });
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

  return ranges;
}

function findHighlightRangeInsertionIndex(ranges: HighlightRange[], start: number): number {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].start < start) low = middle + 1;
    else high = middle;
  }
  return low;
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

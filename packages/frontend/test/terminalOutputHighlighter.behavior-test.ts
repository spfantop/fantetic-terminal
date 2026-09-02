import { strict as assert } from 'node:assert';
import {
  DEFAULT_TERMINAL_HIGHLIGHT_RULES,
  DEFAULT_TERMINAL_HIGHLIGHT_RULES_JSON,
  cloneDefaultTerminalHighlightRules,
  createTerminalHighlightThroughputGuard,
  highlightTerminalOutput,
  parseTerminalHighlightRules,
  parseTerminalHighlightRulesDocument,
  previewTerminalHighlightSegments,
  getTerminalHighlightContrastSummary,
  resolveTerminalHighlightRulesForTheme,
  serializeTerminalHighlightRules,
  createTerminalOutputHighlightStream,
  type TerminalHighlightRule,
} from '../src/utils/terminalOutputHighlighter';
import { presetTerminalThemes } from '../src/features/appearance/config/iterm-themes';
import backendDefaultTerminalHighlightRulesDocument from '../../backend/src/settings/defaultTerminalHighlightRules.json';

const rules: TerminalHighlightRule[] = [
  {
    id: 'error',
    name: 'error',
    enabled: true,
    pattern: 'ERROR',
    flags: 'g',
    foreground: '#ef4444',
    bold: true,
    priority: 10,
  },
  {
    id: 'warn',
    name: 'warn',
    enabled: false,
    pattern: 'WARN',
    flags: 'g',
    foreground: '#f59e0b',
    priority: 5,
  },
];

const highlighted = highlightTerminalOutput('INFO ok\nERROR failed\nWARN skipped\n', {
  enabled: true,
  rules,
});

assert.equal(
  highlighted,
  'INFO ok\n\x1b[1;38;2;239;68;68mERROR\x1b[0m failed\nWARN skipped\n',
);

assert.equal(
  highlightTerminalOutput('\x1b[31mERROR\x1b[0m failed\n', { enabled: true, rules }),
  '\x1b[31mERROR\x1b[0m failed\n',
);

assert.equal(
  highlightTerminalOutput('\x1b[32madmin@host\x1b[0m ERROR failed\n', { enabled: true, rules }),
  '\x1b[32madmin@host\x1b[0m \x1b[1;38;2;239;68;68mERROR\x1b[0m failed\n',
);

assert.equal(
  highlightTerminalOutput('\x1b[?2004hERROR failed\n', { enabled: true, rules }),
  '\x1b[?2004h\x1b[1;38;2;239;68;68mERROR\x1b[0m failed\n',
);

assert.equal(
  highlightTerminalOutput('ERROR failed\n', { enabled: false, rules }),
  'ERROR failed\n',
);

const mutableRules: TerminalHighlightRule[] = [
  {
    id: 'mutable-error',
    name: 'mutable-error',
    enabled: true,
    pattern: 'ERROR',
    flags: 'g',
    foreground: '#ef4444',
    priority: 1,
  },
];
assert.equal(
  highlightTerminalOutput('ERROR\n', { enabled: true, rules: mutableRules }),
  '\x1b[38;2;239;68;68mERROR\x1b[0m\n',
);
mutableRules[0].foreground = '#22c55e';
assert.equal(
  highlightTerminalOutput('ERROR\n', { enabled: true, rules: mutableRules }),
  '\x1b[38;2;34;197;94mERROR\x1b[0m\n',
);

const broadRuleOutput = highlightTerminalOutput('A'.repeat(300), {
  enabled: true,
  rules: [
    {
      id: 'broad',
      name: 'broad',
      enabled: true,
      pattern: '.',
      flags: 'g',
      foreground: '#ef4444',
      priority: 1,
    },
  ],
});
assert.equal((broadRuleOutput.match(/\x1b\[38;2;239;68;68m/g) ?? []).length, 256);

const parsedRules = parseTerminalHighlightRules(serializeTerminalHighlightRules(rules));
assert.equal(parsedRules.length, 2);
assert.equal(parsedRules[0].pattern, 'ERROR');
assert.equal(parseTerminalHighlightRules('[]').length, 0);
assert.equal(parseTerminalHighlightRules(JSON.stringify({ rules })).length, 2);

const parsedDocumentRules = parseTerminalHighlightRulesDocument(JSON.stringify({ rules }));
assert.equal(parsedDocumentRules.length, 2);
assert.equal(parsedDocumentRules[0].pattern, 'ERROR');
assert.throws(() => parseTerminalHighlightRulesDocument('{'), /valid JSON/);
assert.throws(() => parseTerminalHighlightRulesDocument('{"rules":{}}'), /array/);

assert.equal(DEFAULT_TERMINAL_HIGHLIGHT_RULES.length, 62);
assert.ok(DEFAULT_TERMINAL_HIGHLIGHT_RULES.some(rule => rule.id === 'preset-common-command'));
assert.equal(parseTerminalHighlightRules(DEFAULT_TERMINAL_HIGHLIGHT_RULES_JSON).length, 62);
assert.deepEqual(
  backendDefaultTerminalHighlightRulesDocument,
  JSON.parse(DEFAULT_TERMINAL_HIGHLIGHT_RULES_JSON),
  'frontend and backend terminal highlight defaults must never drift',
);

const darkThemeRules = resolveTerminalHighlightRulesForTheme(
  cloneDefaultTerminalHighlightRules(),
  '#1e1e1e',
);
const lightThemeRules = resolveTerminalHighlightRulesForTheme(
  cloneDefaultTerminalHighlightRules(),
  '#ffffff',
);
const darkPresetColors = new Set(
  darkThemeRules.filter(rule => rule.enabled && rule.presetId).map(rule => rule.foreground),
);
assert.ok(darkPresetColors.size <= 12, 'system presets must share a compact semantic palette');
assert.deepEqual(
  Object.fromEntries([
    'preset-java-thread',
    'preset-info',
    'preset-file-line',
    'preset-url',
    'preset-json-boundary',
    'preset-json-key',
    'preset-json-string',
    'preset-json-number',
    'preset-json-literal',
    'preset-json-punctuation',
  ].map(id => [id, darkThemeRules.find(rule => rule.id === id)?.foreground])),
  {
    'preset-java-thread': '#A8B3CF',
    'preset-info': '#6CCFF6',
    'preset-file-line': '#F0DF86',
    'preset-url': '#82D2FF',
    'preset-json-boundary': '#D6A8E5',
    'preset-json-key': '#82D2FF',
    'preset-json-string': '#F1AD8D',
    'preset-json-number': '#B8E58E',
    'preset-json-literal': '#D6A8E5',
    'preset-json-punctuation': '#A8B3CF',
  },
  'dark defaults must preserve a readable hierarchy between context, source, network and JSON syntax',
);
assert.notEqual(
  darkThemeRules.find(rule => rule.id === 'preset-info')?.foreground,
  lightThemeRules.find(rule => rule.id === 'preset-info')?.foreground,
  'system preset colors must adapt to the active terminal background',
);
const previewDarkDefault = (text: string) => previewTerminalHighlightSegments(text, {
  enabled: true,
  rules: darkThemeRules,
});
for (const ipv6Address of [
  '1:2:3:4:5:6:7:8',
  '2001:db8::1',
  'fe80::1',
  '::1',
]) {
  assert.equal(
    previewDarkDefault(ipv6Address).find(segment => segment.text === ipv6Address)?.foreground,
    '#82D2FF',
    `valid IPv6 address must use the network style: ${ipv6Address}`,
  );
}
assert.equal(
  previewDarkDefault('11:26:00').find(segment => segment.text === '11:26:00')?.foreground,
  '#9AA7B8',
  'a bare time must use the timestamp style instead of being misclassified as IPv6',
);
assert.equal(
  previewDarkDefault('aa:bb:cc:dd:ee:ff').some(segment => segment.foreground),
  false,
  'a MAC address must not be misclassified as IPv6',
);
assert.equal(
  getTerminalHighlightContrastSummary(darkThemeRules, '#1e1e1e').failingRuleCount,
  0,
  'theme-managed preset colors must meet WCAG AA contrast on the dark terminal background',
);
assert.equal(
  getTerminalHighlightContrastSummary(lightThemeRules, '#ffffff').failingRuleCount,
  0,
  'theme-managed preset colors must meet WCAG AA contrast on the light terminal background',
);
for (const terminalTheme of presetTerminalThemes) {
  const background = terminalTheme.themeData.background;
  if (typeof background !== 'string') continue;
  const resolvedRules = resolveTerminalHighlightRulesForTheme(
    cloneDefaultTerminalHighlightRules(),
    background,
  );
  assert.equal(
    getTerminalHighlightContrastSummary(resolvedRules, background).failingRuleCount,
    0,
    `system preset colors must meet WCAG AA contrast on ${terminalTheme.name}`,
  );
}

const customizedColorRules = cloneDefaultTerminalHighlightRules();
const customizedInfoRule = customizedColorRules.find(rule => rule.id === 'preset-info');
assert.ok(customizedInfoRule);
customizedInfoRule.foreground = '#abcdef';
const resolvedCustomizedColorRules = resolveTerminalHighlightRulesForTheme(customizedColorRules, '#ffffff');
assert.equal(
  resolvedCustomizedColorRules.find(rule => rule.id === 'preset-info')?.foreground,
  '#abcdef',
  'a user-customized preset color must never be overwritten by theme adaptation',
);
assert.equal(
  getTerminalHighlightContrastSummary(resolvedCustomizedColorRules, '#ffffff').customFailingRuleCount,
  1,
  'unsafe custom colors must be reported without being changed',
);

const currentStackTraceRule = DEFAULT_TERMINAL_HIGHLIGHT_RULES.find(rule => rule.id === 'preset-stacktrace');
assert.ok(currentStackTraceRule);
const migratedStackTraceRule = parseTerminalHighlightRules(JSON.stringify([{
  ...currentStackTraceRule,
  enabled: false,
  foreground: '#123456',
  pattern: '^\\s*at\\s+(?:[a-zA-Z_$][\\w$]*\\.)+[A-Za-z_$][\\w$]*\\([^)]*\\)',
  priority: 129,
}]))[0];
assert.deepEqual(
  [
    migratedStackTraceRule.pattern,
    migratedStackTraceRule.priority,
    migratedStackTraceRule.enabled,
    migratedStackTraceRule.foreground,
  ],
  [currentStackTraceRule.pattern, currentStackTraceRule.priority, false, '#123456'],
  'legacy default fields must migrate without replacing user style choices',
);

const customizedStackTraceRule = parseTerminalHighlightRules(JSON.stringify([{
  ...currentStackTraceRule,
  pattern: '^custom-stack-frame$',
  priority: 17,
}]))[0];
assert.deepEqual(
  [customizedStackTraceRule.pattern, customizedStackTraceRule.priority],
  ['^custom-stack-frame$', 17],
  'customized stack-trace fields must not be migrated',
);

const currentPromptPathRule = DEFAULT_TERMINAL_HIGHLIGHT_RULES.find(rule => rule.id === 'preset-prompt-path');
assert.ok(currentPromptPathRule);
const migratedPromptPathRule = parseTerminalHighlightRules(JSON.stringify([{
  ...currentPromptPathRule,
  pattern: '(?<=:)(?:~|/)[A-Za-z0-9._~:@%+\\-\\/]*(?=\\s|[$#❯➜])',
}]))[0];
assert.equal(
  migratedPromptPathRule.pattern,
  currentPromptPathRule.pattern,
  'legacy prompt-path defaults must migrate so URLs are no longer split at their double slash',
);

const currentIpv6Rule = DEFAULT_TERMINAL_HIGHLIGHT_RULES.find(rule => rule.id === 'preset-ipv6');
assert.ok(currentIpv6Rule);
const legacyIpv6Pattern = '\\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\\b';
const migratedIpv6Rule = parseTerminalHighlightRules(JSON.stringify([{
  ...currentIpv6Rule,
  pattern: legacyIpv6Pattern,
}]))[0];
assert.equal(
  migratedIpv6Rule.pattern,
  currentIpv6Rule.pattern,
  'legacy IPv6 defaults must migrate away from time and MAC false positives',
);
const customizedIpv6Rule = parseTerminalHighlightRules(JSON.stringify([{
  ...currentIpv6Rule,
  pattern: `${legacyIpv6Pattern}|CUSTOM_IPV6`,
}]))[0];
assert.equal(
  customizedIpv6Rule.pattern,
  `${legacyIpv6Pattern}|CUSTOM_IPV6`,
  'customized IPv6 patterns must not be migrated',
);

const legacyBackendDefaultRules = cloneDefaultTerminalHighlightRules()
  .filter(rule => [
    'preset-success',
    'preset-git-subcommand',
    'preset-double-quoted-string',
    'preset-file-line',
    'preset-sql-keyword',
  ].includes(rule.id))
  .map(rule => {
    if (rule.id === 'preset-success') {
      return {
        ...rule,
        pattern: '\\b(SUCCESS|SUCCEEDED|PASS(?:ED)?|OK|DONE|READY|STARTED|RUNNING|UP|COMPLETED)\\b',
        flags: 'gi',
      };
    }
    if (rule.id === 'preset-git-subcommand' || rule.id === 'preset-double-quoted-string') {
      return { ...rule, enabled: true };
    }
    if (rule.id === 'preset-file-line') {
      return { ...rule, foreground: '#FFD866', underline: true };
    }
    return { ...rule, flags: 'gi' };
  });
const migratedLegacyBackendDefaults = parseTerminalHighlightRules(JSON.stringify(legacyBackendDefaultRules));
for (const migratedRule of migratedLegacyBackendDefaults) {
  const currentRule = DEFAULT_TERMINAL_HIGHLIGHT_RULES.find(rule => rule.id === migratedRule.id);
  assert.ok(currentRule);
  assert.deepEqual(
    migratedRule,
    currentRule,
    `untouched historical backend default must migrate completely: ${migratedRule.id}`,
  );
}
const customizedLegacyFileLine = parseTerminalHighlightRules(JSON.stringify([{
  ...DEFAULT_TERMINAL_HIGHLIGHT_RULES.find(rule => rule.id === 'preset-file-line'),
  foreground: '#123456',
  underline: true,
}]))[0];
assert.equal(customizedLegacyFileLine.foreground, '#123456');
assert.equal(
  customizedLegacyFileLine.underline,
  true,
  'a historical rule with customized fields must not be rewritten as an untouched default',
);

const legacyJsonPresetDefinitions: Array<[string, string, string, string, number, string]> = [
  [
    'preset-json-inline-object',
    'jsonInlineObject',
    '\\{(?:[^{}\\"\\\\]+|\\\\.|\\"(?:\\\\.|[^\\"\\\\])*\\"|\\[(?:[^\\[\\]\\"\\\\]+|\\\\.|\\"(?:\\\\.|[^\\"\\\\])*\\")*\\]|\\{(?:[^{}\\"\\\\]+|\\\\.|\\"(?:\\\\.|[^\\"\\\\])*\\")*\\})*\\}',
    'g',
    240,
    'jsonInlineObject',
  ],
  [
    'preset-json-inline-array',
    'jsonInlineArray',
    '\\[(?:[^\\[\\]{}\\"\\\\]+|\\\\.|\\"(?:\\\\.|[^\\"\\\\])*\\"|\\{(?:[^{}\\"\\\\]+|\\\\.|\\"(?:\\\\.|[^\\"\\\\])*\\")*\\})*\\]',
    'g',
    239,
    'jsonInlineArray',
  ],
  [
    'preset-json-pretty-key-value-line',
    'jsonPrettyKeyValueLine',
    '^\\s*\\"(?:\\\\.|[^\\"\\\\])+\\"\\s*:\\s*(?:\\"(?:\\\\.|[^\\"\\\\])*\\"|[-+]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|true|false|null|\\{.*\\}|\\[.*\\])\\s*,?\\s*$',
    'gim',
    238,
    'jsonPrettyKeyValueLine',
  ],
  [
    'preset-json-pretty-bracket-line',
    'jsonPrettyBracketLine',
    '^\\s*[\\{\\}\\[\\]],?\\s*$',
    'gm',
    237,
    'jsonPrettyBracketLine',
  ],
];
const legacyJsonPresetRules: TerminalHighlightRule[] = legacyJsonPresetDefinitions
  .map(([id, name, pattern, flags, priority, presetId]) => ({
  id,
  name,
  enabled: true,
  pattern: String(pattern),
  flags: String(flags),
  foreground: '#98C379',
  bold: false,
  underline: false,
  priority: Number(priority),
  stopOnMatch: false,
  presetId,
}));
const historicalJsonDefaults = cloneDefaultTerminalHighlightRules()
  .filter(rule => rule.id !== 'preset-java-thread' && !rule.id.startsWith('preset-json-'));
historicalJsonDefaults.push(...legacyJsonPresetRules);
const migratedHistoricalJsonDefaults = parseTerminalHighlightRules(JSON.stringify(historicalJsonDefaults));
assert.equal(migratedHistoricalJsonDefaults.length, DEFAULT_TERMINAL_HIGHLIGHT_RULES.length);
assert.ok(migratedHistoricalJsonDefaults.some(rule => rule.id === 'preset-java-thread'));
for (const semanticJsonRuleId of [
  'preset-json-boundary',
  'preset-json-key',
  'preset-json-string',
  'preset-json-number',
  'preset-json-literal',
  'preset-json-punctuation',
]) {
  assert.ok(
    migratedHistoricalJsonDefaults.some(rule => rule.id === semanticJsonRuleId),
    `historical JSON defaults must gain the semantic preset: ${semanticJsonRuleId}`,
  );
}
assert.equal(
  migratedHistoricalJsonDefaults.some(rule => rule.id === 'preset-json-inline-object'),
  false,
  'obsolete untouched JSON regex presets must be removed after migration',
);
const customizedLegacyJsonRules = legacyJsonPresetRules.map((rule, index) => (
  index === 0 ? { ...rule, foreground: '#123456' } : rule
));
const preservedCustomizedLegacyJsonRules = parseTerminalHighlightRules(JSON.stringify(customizedLegacyJsonRules));
assert.ok(
  preservedCustomizedLegacyJsonRules.some(rule => rule.id === 'preset-json-inline-object'),
  'customized legacy JSON presets must remain in compatibility mode',
);
assert.equal(
  preservedCustomizedLegacyJsonRules.some(rule => rule.id === 'preset-json-boundary'),
  false,
  'semantic JSON defaults must not be injected into a customized legacy JSON group',
);

const currentCausedByRule = DEFAULT_TERMINAL_HIGHLIGHT_RULES.find(rule => rule.id === 'preset-caused-by');
assert.ok(currentCausedByRule);
const migratedCausedByRule = parseTerminalHighlightRules(JSON.stringify([{
  ...currentCausedByRule,
  pattern: '^\\s*Caused by:\\s+.*$',
  priority: 130,
}]))[0];
assert.deepEqual(
  [migratedCausedByRule.pattern, migratedCausedByRule.priority],
  [currentCausedByRule.pattern, currentCausedByRule.priority],
  'persisted legacy cause-chain defaults must migrate to the current behavior',
);

const previewSegments = previewTerminalHighlightSegments('ERROR failed', {
  enabled: true,
  rules,
});
assert.deepEqual(previewSegments, [
  {
    text: 'ERROR',
    foreground: '#ef4444',
    background: undefined,
    bold: true,
    underline: false,
  },
  { text: ' failed' },
]);

const streamHighlighter = createTerminalOutputHighlightStream();
const commandRule: TerminalHighlightRule[] = [
  {
    id: 'grep-command',
    name: 'grep-command',
    enabled: true,
    pattern: '\\bgrep\\b',
    flags: 'g',
    foreground: '#DCDCAA',
    bold: true,
    priority: 10,
  },
];

assert.equal(
  streamHighlighter.write('root@BBT:~# gre', { enabled: true, rules: commandRule }),
  'root@BBT:~# gre',
);
assert.equal(
  streamHighlighter.write('p -n --color=always\r\n', { enabled: true, rules: commandRule }),
  'p -n --color=always\r\n',
);
assert.equal(streamHighlighter.flush({ enabled: true, rules: commandRule }), '');

assert.equal(
  streamHighlighter.write('root@BBT:~# gre', { enabled: true, rules: commandRule }),
  'root@BBT:~# gre',
);
assert.equal(
  streamHighlighter.flush({ enabled: true, rules: commandRule }),
  '',
);

const promptStreamHighlighter = createTerminalOutputHighlightStream();
assert.equal(
  promptStreamHighlighter.write('\r\n', { enabled: true, rules: commandRule }),
  '\r\n',
);
assert.equal(
  promptStreamHighlighter.write('root@BBT:~# ', { enabled: true, rules: commandRule }),
  'root@BBT:~# ',
);

const completeLineStreamHighlighter = createTerminalOutputHighlightStream();
assert.equal(
  completeLineStreamHighlighter.write('DONE\r\n', { enabled: true, rules: commandRule }),
  'DONE\r\n',
);

const bracketedPasteStreamHighlighter = createTerminalOutputHighlightStream();
assert.equal(
  bracketedPasteStreamHighlighter.write('\x1b[?2004h', { enabled: true, rules: commandRule }),
  '\x1b[?2004h',
);
assert.equal(
  bracketedPasteStreamHighlighter.write('hyf@debian:~$ ', { enabled: true, rules: commandRule }),
  'hyf@debian:~$ ',
);

const splitControlSequenceStreamHighlighter = createTerminalOutputHighlightStream();
assert.equal(
  splitControlSequenceStreamHighlighter.write('\x1b[', { enabled: true, rules: commandRule }),
  '',
);
assert.equal(
  splitControlSequenceStreamHighlighter.write('?2004hhyf@debian:~$ ', { enabled: true, rules: commandRule }),
  '\x1b[?2004hhyf@debian:~$ ',
);

const throughputGuard = createTerminalHighlightThroughputGuard({
  suspendByteThreshold: 16,
  resumeAfterMs: 100,
  now: () => 0,
});
assert.equal(throughputGuard.shouldHighlight(8), true);
assert.equal(throughputGuard.shouldHighlight(20), false);
assert.equal(throughputGuard.shouldHighlight(1), false);
throughputGuard.setNow(() => 101);
assert.equal(throughputGuard.shouldHighlight(1), true);

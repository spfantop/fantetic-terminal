import { strict as assert } from 'node:assert';
import {
  DEFAULT_TERMINAL_HIGHLIGHT_RULES,
  DEFAULT_TERMINAL_HIGHLIGHT_RULES_JSON,
  highlightTerminalOutput,
  parseTerminalHighlightRules,
  parseTerminalHighlightRulesDocument,
  previewTerminalHighlightSegments,
  serializeTerminalHighlightRules,
  createTerminalOutputHighlightStream,
  type TerminalHighlightRule,
} from '../src/utils/terminalOutputHighlighter';

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

assert.equal(DEFAULT_TERMINAL_HIGHLIGHT_RULES.length, 59);
assert.ok(DEFAULT_TERMINAL_HIGHLIGHT_RULES.some(rule => rule.id === 'preset-common-command'));
assert.equal(parseTerminalHighlightRules(DEFAULT_TERMINAL_HIGHLIGHT_RULES_JSON).length, 59);

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
  'root@BBT:~# ',
);
assert.equal(
  streamHighlighter.write('p -n --color=always\r\n', { enabled: true, rules: commandRule }),
  '\x1b[1;38;2;220;220;170mgrep\x1b[0m -n --color=always\r\n',
);
assert.equal(streamHighlighter.flush({ enabled: true, rules: commandRule }), '');

assert.equal(
  streamHighlighter.write('root@BBT:~# gre', { enabled: true, rules: commandRule }),
  'root@BBT:~# ',
);
assert.equal(
  streamHighlighter.flush({ enabled: true, rules: commandRule }),
  'gre',
);

const promptStreamHighlighter = createTerminalOutputHighlightStream();
assert.equal(
  promptStreamHighlighter.write('\r\n', { enabled: true, rules: commandRule }),
  '',
);
assert.equal(
  promptStreamHighlighter.write('root@BBT:~# ', { enabled: true, rules: commandRule }),
  '\r\nroot@BBT:~# ',
);

const completeLineStreamHighlighter = createTerminalOutputHighlightStream();
assert.equal(
  completeLineStreamHighlighter.write('DONE\r\n', { enabled: true, rules: commandRule }),
  'DONE\r\n',
);

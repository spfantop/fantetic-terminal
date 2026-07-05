import { strict as assert } from 'node:assert';
import {
  highlightTerminalOutput,
  parseTerminalHighlightRules,
  parseTerminalHighlightRulesDocument,
  previewTerminalHighlightSegments,
  serializeTerminalHighlightRules,
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

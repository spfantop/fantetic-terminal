import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createTerminalSearchOptions,
  createTerminalSearchScheduler,
  TERMINAL_SEARCH_DELAY_MS,
  TERMINAL_SEARCH_DECORATION_COLUMN_LIMIT,
  TERMINAL_SEARCH_DECORATION_LINE_LIMIT,
  TERMINAL_SEARCH_HIGHLIGHT_LIMIT,
  TERMINAL_SEARCH_OPTIONS,
  shouldDecorateTerminalSearch,
  searchTerminalBuffer,
  TERMINAL_SEARCH_CHUNK_LINES,
  TERMINAL_SEARCH_POSITION_LIMIT,
} from '../src/utils/terminalSearch';

type PendingTimer = {
  callback: () => void;
  delay: number;
};

const pendingTimers = new Map<number, PendingTimer>();
let nextTimerId = 1;
const matchedTerms: string[] = [];
const scheduler = createTerminalSearchScheduler<string>({
  onSearch: term => matchedTerms.push(term),
  timer: {
    setTimeout: (callback, delay) => {
      const id = nextTimerId++;
      pendingTimers.set(id, { callback, delay });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: handle => {
      pendingTimers.delete(handle as unknown as number);
    },
  },
});

scheduler.schedule('e');
scheduler.schedule('er');
scheduler.schedule('error');
assert.equal(pendingTimers.size, 1, 'rapid input should keep only the latest pending search');
assert.equal([...pendingTimers.values()][0].delay, TERMINAL_SEARCH_DELAY_MS);
const [pendingTimerId, pendingTimer] = [...pendingTimers.entries()][0];
pendingTimers.delete(pendingTimerId);
pendingTimer.callback();
assert.deepEqual(matchedTerms, ['error'], 'only the final input should search after the debounce delay');

scheduler.schedule('warning');
scheduler.runNow('warning');
assert.equal(pendingTimers.size, 0, 'manual next/previous navigation should cancel the pending search');
assert.deepEqual(matchedTerms, ['error', 'warning'], 'manual navigation should search immediately');

assert.equal(TERMINAL_SEARCH_HIGHLIGHT_LIMIT, 200);
assert.deepEqual(TERMINAL_SEARCH_OPTIONS, {
  incremental: false,
  caseSensitive: false,
  decorations: {
    matchBackground: '#1D4ED8',
    matchBorder: '#93C5FD',
    matchOverviewRuler: '#1D4ED8',
    activeMatchBackground: '#F59E0B',
    activeMatchBorder: '#FDE68A',
    activeMatchColorOverviewRuler: '#F59E0B',
  },
});

assert.equal(createTerminalSearchOptions(false).caseSensitive, false, 'search should ignore case by default');
assert.equal(createTerminalSearchOptions(true).caseSensitive, true, 'the match-case control should enable case-sensitive search');
assert.equal(
  createTerminalSearchOptions(false, false).decorations,
  undefined,
  'large-buffer search must be able to keep only the active xterm selection',
);
assert.equal(TERMINAL_SEARCH_DECORATION_LINE_LIMIT, 1000);
assert.equal(TERMINAL_SEARCH_DECORATION_COLUMN_LIMIT, 512);
assert.equal(shouldDecorateTerminalSearch({ bufferLineCount: 1000, cols: 512 }), true);
assert.equal(
  shouldDecorateTerminalSearch({ bufferLineCount: 1001, cols: 120 }),
  false,
  'large scrollback must skip the synchronous all-match decoration pass',
);
assert.equal(
  shouldDecorateTerminalSearch({ bufferLineCount: 200, cols: 1024 }),
  false,
  'wide single-line output must skip all-match decorations even with short scrollback',
);

const lines = ['INFO ready', 'error: disk error', 'warning', 'ERROR: network error'];
let yieldCount = 0;
const searchResult = await searchTerminalBuffer({
  getLine: row => ({ translateToString: () => lines[row] ?? '' }),
  lineCount: lines.length,
  term: 'error',
  caseSensitive: false,
  chunkLines: 2,
  yieldToHost: async () => { yieldCount += 1; },
});
assert.equal(searchResult.count, 4, 'large-buffer search should report the exact match count');
assert.equal(searchResult.positions.length, 4);
assert.ok(yieldCount >= 1, 'large-buffer search should yield between chunks');

const limitedResult = await searchTerminalBuffer({
  getLine: row => ({ translateToString: () => row < 4 ? 'x x' : '' }),
  lineCount: 10,
  term: 'x',
  caseSensitive: true,
  positionLimit: 3,
  yieldToHost: async () => {},
});
assert.equal(limitedResult.count, 8, 'result count remains exact when positions are capped');
assert.equal(limitedResult.positions.length, 3);
assert.equal(limitedResult.truncated, true);
assert.equal(TERMINAL_SEARCH_CHUNK_LINES, 128);
assert.equal(TERMINAL_SEARCH_POSITION_LIMIT, 2000);

let cancelled = false;
const cancelledResult = await searchTerminalBuffer({
  getLine: () => ({ translateToString: () => 'error' }),
  lineCount: 1000,
  term: 'error',
  caseSensitive: true,
  signal: { get aborted() { return cancelled; } },
  chunkLines: 2,
  yieldToHost: async () => { cancelled = true; },
});
assert.ok(cancelledResult.count < 1000, 'a newer search should cancel the previous scan');

const terminalSource = readFileSync(resolve('src/components/Terminal.vue'), 'utf8');
assert.match(
  terminalSource,
  /allowProposedApi:\s*true/,
  'terminal search decorations require xterm proposed API support to be enabled',
);
assert.match(
  terminalSource,
  /event\.ctrlKey && !event\.altKey && !event\.shiftKey && event\.code === 'KeyF'[\s\S]*openTerminalSearch\(\)/,
  'Ctrl+F should be intercepted only by the focused terminal keyboard handler',
);
assert.match(terminalSource, /class="terminal-search-popover"/);
assert.match(terminalSource, /onDidChangeResults/, 'search result count should follow the addon result events');
assert.match(terminalSource, /terminalSearchResultLabel/, 'search result count should be displayed in the popover');
assert.match(terminalSource, /searchTerminalBuffer/, 'large-buffer search should use the yielding scanner');
assert.match(terminalSource, /terminalSearchResultCountExact/, 'result count should not be capped by the decoration limit');
assert.match(terminalSource, /registerDecoration/, 'the active large-buffer match should have a stable decoration');
assert.match(terminalSource, /toggleTerminalSearchCaseSensitive/, 'the popover should provide a match-case toggle');
assert.match(
  terminalSource,
  /shouldDecorateTerminalSearch/,
  'the terminal component must select the bounded search mode from the live buffer size',
);
assert.match(terminalSource, /@click="findTerminalSearchPrevious"/);
assert.match(terminalSource, /@submit\.prevent="findTerminalSearchNext"/);
assert.match(terminalSource, /@click="closeTerminalSearch"/);

console.log('terminal search behavior ok');

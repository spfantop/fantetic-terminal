import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createTerminalSearchOptions,
  createTerminalSearchScheduler,
  TERMINAL_SEARCH_DELAY_MS,
  TERMINAL_SEARCH_HIGHLIGHT_LIMIT,
  TERMINAL_SEARCH_OPTIONS,
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
assert.match(terminalSource, /toggleTerminalSearchCaseSensitive/, 'the popover should provide a match-case toggle');
assert.match(terminalSource, /@click="findTerminalSearchPrevious"/);
assert.match(terminalSource, /@submit\.prevent="findTerminalSearchNext"/);
assert.match(terminalSource, /@click="closeTerminalSearch"/);

console.log('terminal search behavior ok');

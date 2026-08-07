import type { ISearchOptions } from '@xterm/addon-search';

export const TERMINAL_SEARCH_DELAY_MS = 180;
export const TERMINAL_SEARCH_HIGHLIGHT_LIMIT = 200;
export const TERMINAL_SEARCH_DECORATION_LINE_LIMIT = 1000;
export const TERMINAL_SEARCH_DECORATION_COLUMN_LIMIT = 512;

const TERMINAL_SEARCH_DECORATIONS = {
  matchBackground: '#1D4ED8',
  matchBorder: '#93C5FD',
  matchOverviewRuler: '#1D4ED8',
  activeMatchBackground: '#F59E0B',
  activeMatchBorder: '#FDE68A',
  activeMatchColorOverviewRuler: '#F59E0B',
};

export const createTerminalSearchOptions = (caseSensitive: boolean, decorateMatches = true): ISearchOptions => ({
  incremental: false,
  caseSensitive,
  decorations: decorateMatches ? TERMINAL_SEARCH_DECORATIONS : undefined,
});

export const TERMINAL_SEARCH_OPTIONS = createTerminalSearchOptions(false);

export const shouldDecorateTerminalSearch = ({
  bufferLineCount,
  cols,
}: {
  bufferLineCount: number;
  cols: number;
}) => bufferLineCount <= TERMINAL_SEARCH_DECORATION_LINE_LIMIT
  && cols <= TERMINAL_SEARCH_DECORATION_COLUMN_LIMIT;

type TimeoutHandle = ReturnType<typeof setTimeout>;

type TerminalSearchTimer = {
  setTimeout(callback: () => void, delay: number): TimeoutHandle;
  clearTimeout(handle: TimeoutHandle): void;
};

type CreateTerminalSearchSchedulerOptions<T> = {
  onSearch(request: T): void;
  delayMs?: number;
  timer?: TerminalSearchTimer;
};

export function createTerminalSearchScheduler<T>({
  onSearch,
  delayMs = TERMINAL_SEARCH_DELAY_MS,
  timer = globalThis,
}: CreateTerminalSearchSchedulerOptions<T>) {
  let pendingTimer: TimeoutHandle | null = null;

  const cancel = () => {
    if (pendingTimer === null) return;
    timer.clearTimeout(pendingTimer);
    pendingTimer = null;
  };

  const schedule = (request: T) => {
    cancel();
    pendingTimer = timer.setTimeout(() => {
      pendingTimer = null;
      onSearch(request);
    }, delayMs);
  };

  const runNow = (request: T) => {
    cancel();
    onSearch(request);
  };

  return { schedule, runNow, cancel };
}

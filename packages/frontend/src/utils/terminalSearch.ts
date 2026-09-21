import type { ISearchOptions } from '@xterm/addon-search';

export const TERMINAL_SEARCH_DELAY_MS = 180;
export const TERMINAL_SEARCH_HIGHLIGHT_LIMIT = 200;
export const TERMINAL_SEARCH_DECORATION_LINE_LIMIT = 1000;
export const TERMINAL_SEARCH_DECORATION_COLUMN_LIMIT = 512;
export const TERMINAL_SEARCH_CHUNK_LINES = 128;
export const TERMINAL_SEARCH_POSITION_LIMIT = 2000;

const TERMINAL_SEARCH_DECORATIONS = {
  matchBackground: '#1D4ED8',
  matchBorder: '#93C5FD',
  matchOverviewRuler: '#1D4ED8',
  activeMatchBackground: '#F59E0B',
  activeMatchBorder: '#FDE68A',
  activeMatchColorOverviewRuler: '#F59E0B',
};

export const TERMINAL_SEARCH_ACTIVE_BACKGROUND = TERMINAL_SEARCH_DECORATIONS.activeMatchBackground;

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

export type TerminalSearchLine = {
  translateToString(trimRight?: boolean): string;
  getCell?: (index: number) => { getChars?: () => string; getWidth?: () => number } | undefined;
};

export type TerminalBufferSearchResult = {
  count: number;
  positions: Array<{ row: number; col: number; length: number }>;
  truncated: boolean;
};

type TerminalBufferSearchOptions = {
  getLine(row: number): TerminalSearchLine | undefined;
  lineCount: number;
  term: string;
  caseSensitive: boolean;
  signal?: { readonly aborted: boolean };
  chunkLines?: number;
  positionLimit?: number;
  yieldToHost?: () => Promise<void>;
  onProgress?: (count: number) => void;
};

const defaultYieldToHost = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const stringOffsetToCellColumn = (line: TerminalSearchLine, offset: number): number => {
  if (!line.getCell || offset <= 0) return Math.max(0, offset);
  let stringOffset = 0;
  let column = 0;
  while (stringOffset < offset) {
    const cell = line.getCell(column);
    if (!cell) return column;
    const chars = cell.getChars?.() ?? '';
    const width = cell.getWidth?.() ?? (chars ? 1 : 1);
    stringOffset += chars.length || 1;
    column += width || 1;
  }
  return column;
};

/**
 * Searches xterm buffer in bounded time slices. This keeps large-log search
 * responsive while still returning an exact match count.
 */
export async function searchTerminalBuffer({
  getLine,
  lineCount,
  term,
  caseSensitive,
  signal,
  chunkLines = TERMINAL_SEARCH_CHUNK_LINES,
  positionLimit = TERMINAL_SEARCH_POSITION_LIMIT,
  yieldToHost = defaultYieldToHost,
  onProgress,
}: TerminalBufferSearchOptions): Promise<TerminalBufferSearchResult> {
  const normalizedTerm = caseSensitive ? term : term.toLocaleLowerCase();
  if (!normalizedTerm) return { count: 0, positions: [], truncated: false };

  const positions: Array<{ row: number; col: number; length: number }> = [];
  let count = 0;
  for (let row = 0; row < lineCount; row += 1) {
    if (signal?.aborted) return { count, positions, truncated: count > positions.length };
    const line = getLine(row);
    const text = line?.translateToString(true) ?? '';
    const haystack = caseSensitive ? text : text.toLocaleLowerCase();
    let offset = 0;
    while (offset <= haystack.length - normalizedTerm.length) {
      const matchOffset = haystack.indexOf(normalizedTerm, offset);
      if (matchOffset < 0) break;
      count += 1;
      if (positions.length < positionLimit) {
        positions.push({
          row,
          col: stringOffsetToCellColumn(line!, matchOffset),
          length: normalizedTerm.length,
        });
      }
      offset = matchOffset + Math.max(normalizedTerm.length, 1);
    }
    if (row % chunkLines === chunkLines - 1) {
      onProgress?.(count);
      await yieldToHost();
    }
  }
  onProgress?.(count);
  return { count, positions, truncated: count > positions.length };
}

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

export const TERMINAL_SINGLE_LINE_MIN_COLS = 256;
export const TERMINAL_SINGLE_LINE_MAX_COLS = 4096;

type TerminalBufferLine = {
  isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
};

type TerminalBuffer = {
  length: number;
  getLine(index: number): TerminalBufferLine | undefined;
};

export function hasTerminalBufferWrappedLines(buffer: TerminalBuffer, startRow = 0): boolean {
  const firstRow = Math.max(0, Math.min(startRow, buffer.length));
  for (let row = firstRow; row < buffer.length; row += 1) {
    if (buffer.getLine(row)?.isWrapped) return true;
  }
  return false;
}

type ResolveTerminalSingleLineOutputColsOptions = {
  buffer: TerminalBuffer;
  currentCols: number;
  visibleCols: number;
  startRow?: number;
};

export function resolveTerminalSingleLineOutputCols({
  buffer,
  currentCols,
  visibleCols,
  startRow = 0,
}: ResolveTerminalSingleLineOutputColsOptions): number {
  const sourceCols = Math.max(1, currentCols);
  let firstRow = Math.max(0, Math.min(startRow, Math.max(0, buffer.length - 1)));
  let rewoundRows = 0;
  while (firstRow > 0 && buffer.getLine(firstRow)?.isWrapped) {
    firstRow -= 1;
    rewoundRows += 1;
    if ((rewoundRows + 1) * sourceCols >= TERMINAL_SINGLE_LINE_MAX_COLS) {
      return TERMINAL_SINGLE_LINE_MAX_COLS;
    }
  }

  let maxLogicalLineLength = 0;
  let logicalLineLength = 0;
  for (let row = firstRow; row < buffer.length; row += 1) {
    const line = buffer.getLine(row);
    if (!line) continue;
    const nextLineWraps = Boolean(buffer.getLine(row + 1)?.isWrapped);
    logicalLineLength += nextLineWraps ? sourceCols : line.translateToString(true).length;
    if (logicalLineLength >= TERMINAL_SINGLE_LINE_MAX_COLS) return TERMINAL_SINGLE_LINE_MAX_COLS;
    if (!nextLineWraps) {
      maxLogicalLineLength = Math.max(maxLogicalLineLength, logicalLineLength);
      logicalLineLength = 0;
    }
  }
  maxLogicalLineLength = Math.max(maxLogicalLineLength, logicalLineLength);

  const requiredCols = Math.max(visibleCols, maxLogicalLineLength, TERMINAL_SINGLE_LINE_MIN_COLS);
  let resolvedCols = TERMINAL_SINGLE_LINE_MIN_COLS;
  while (resolvedCols < requiredCols && resolvedCols < TERMINAL_SINGLE_LINE_MAX_COLS) {
    resolvedCols *= 2;
  }
  return Math.min(resolvedCols, TERMINAL_SINGLE_LINE_MAX_COLS);
}

export const calculateCenteredTerminalHorizontalPadding = (
  viewportWidth: number,
  scrollbarWidth: number,
  columns: number,
  cellWidth: number,
) => Math.max(0, (viewportWidth - scrollbarWidth - (columns * cellWidth)) / 2);

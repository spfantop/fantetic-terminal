export const TERMINAL_ZOOM_MIN_FONT_SIZE = 8;
export const TERMINAL_WHEEL_ZOOM_MAX_FONT_SIZE = 40;
export const TERMINAL_TOUCH_ZOOM_MAX_FONT_SIZE = 72;
export const TERMINAL_ZOOM_POPUP_HIDE_DELAY = 1800;

export const clampTerminalFontSize = (
  fontSize: number,
  minFontSize = TERMINAL_ZOOM_MIN_FONT_SIZE,
  maxFontSize = TERMINAL_WHEEL_ZOOM_MAX_FONT_SIZE,
) => Math.max(minFontSize, Math.min(fontSize, maxFontSize));

export const calculateTerminalZoomPercent = (fontSize: number, originalFontSize: number) => {
  if (!Number.isFinite(fontSize) || fontSize <= 0) return 100;
  if (!Number.isFinite(originalFontSize) || originalFontSize <= 0) return 100;

  return Math.round((fontSize / originalFontSize) * 100);
};

export const isTerminalZoomReset = (fontSize: number, originalFontSize: number) => (
  calculateTerminalZoomPercent(fontSize, originalFontSize) === 100
);

export const resolveTerminalWheelZoomUpdate = (currentFontSize: number, deltaY: number) => ({
  fontSize: clampTerminalFontSize(
    currentFontSize + (deltaY < 0 ? 1 : -1),
    TERMINAL_ZOOM_MIN_FONT_SIZE,
    TERMINAL_WHEEL_ZOOM_MAX_FONT_SIZE,
  ),
  persistAppearanceSetting: false,
});

export interface NativeRemoteCursorDisplay {
  oncursor: ((canvas: HTMLCanvasElement, x: number, y: number) => void) | null;
  showCursor(shown: boolean): void;
}

export interface NativeRemoteCursorMouse {
  setCursor(canvas: HTMLCanvasElement, x: number, y: number): boolean;
}

/**
 * Uses the browser cursor for immediate local movement while preserving the
 * remote cursor shape. The Guacamole software cursor remains as a compatibility
 * fallback for browsers which reject CSS cursor images or hotspots.
 */
export function setupNativeRemoteCursor(
  display: NativeRemoteCursorDisplay,
  mouse: NativeRemoteCursorMouse,
  displayElement: HTMLElement,
): () => void {
  const previousCursorHandler = display.oncursor;
  let active = true;

  const handleCursor = (canvas: HTMLCanvasElement, x: number, y: number) => {
    if (!active) return;

    let nativeCursorApplied = false;
    try {
      nativeCursorApplied = mouse.setCursor(canvas, x, y);
    } catch {
      nativeCursorApplied = false;
    }

    display.showCursor(!nativeCursorApplied);
    if (!nativeCursorApplied) displayElement.style.cursor = 'none';
  };

  display.showCursor(false);
  display.oncursor = handleCursor;

  return () => {
    if (!active) return;
    active = false;
    if (display.oncursor === handleCursor) display.oncursor = previousCursorHandler;
    display.showCursor(false);
    displayElement.style.cursor = 'default';
  };
}

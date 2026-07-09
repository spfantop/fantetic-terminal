import type { Ref } from 'vue';

type MobileFlag = boolean | Ref<boolean> | (() => boolean);

export interface MobileLongPressHandlers {
  onTouchstart: (event: TouchEvent) => void;
  onTouchmove: (event: TouchEvent) => void;
  onTouchend: (event: TouchEvent) => void;
  onTouchcancel: (event: TouchEvent) => void;
  onClickCapture: (event: MouseEvent) => void;
}

export interface MobileLongPressOptions {
  isMobile: MobileFlag;
  duration?: number;
  moveTolerance?: number;
  onLongPress: (event: TouchEvent, point: { x: number; y: number }) => void;
}

export const createLongPressContextMenuEvent = (
  event: TouchEvent,
  point: { x: number; y: number },
): MouseEvent => ({
  isMobileLongPressContextMenuEvent: true,
  clientX: point.x,
  clientY: point.y,
  button: 2,
  target: event.target,
  currentTarget: event.currentTarget,
  preventDefault: () => event.preventDefault(),
  stopPropagation: () => event.stopPropagation(),
  stopImmediatePropagation: () => event.stopImmediatePropagation(),
} as unknown as MouseEvent);

const readMobileFlag = (flag: MobileFlag): boolean => {
  if (typeof flag === 'function') return flag();
  if (typeof flag === 'object' && flag !== null && 'value' in flag) return Boolean(flag.value);
  return Boolean(flag);
};

export function createMobileLongPressHandlers(options: MobileLongPressOptions): MobileLongPressHandlers {
  const duration = options.duration ?? 600;
  const moveTolerance = options.moveTolerance ?? 12;
  let timer: number | null = null;
  let startX = 0;
  let startY = 0;
  let longPressTriggered = false;

  const isMobile = () => readMobileFlag(options.isMobile);

  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const reset = () => {
    clearTimer();
    startX = 0;
    startY = 0;
  };

  const onTouchstart = (event: TouchEvent) => {
    if (!isMobile() || event.touches.length !== 1) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    longPressTriggered = false;
    clearTimer();
    timer = window.setTimeout(() => {
      timer = null;
      longPressTriggered = true;
      event.preventDefault();
      options.onLongPress(event, { x: startX, y: startY });
    }, duration);
  };

  const onTouchmove = (event: TouchEvent) => {
    if (!isMobile() || timer === null || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (Math.abs(touch.clientX - startX) > moveTolerance || Math.abs(touch.clientY - startY) > moveTolerance) {
      reset();
    }
  };

  const onTouchend = (event: TouchEvent) => {
    if (!isMobile()) return;
    clearTimer();
    if (longPressTriggered) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const onTouchcancel = () => {
    reset();
  };

  const onClickCapture = (event: MouseEvent) => {
    if (!isMobile() || !longPressTriggered) return;
    longPressTriggered = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    onTouchstart,
    onTouchmove,
    onTouchend,
    onTouchcancel,
    onClickCapture,
  };
}

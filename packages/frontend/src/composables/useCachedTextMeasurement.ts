const MAX_TEXT_MEASUREMENT_CACHE_SIZE = 1000;

const measurementCache = new Map<string, number>();
let measurementCanvas: HTMLCanvasElement | null = null;

const getMeasurementContext = () => {
  if (typeof document === 'undefined') return null;
  measurementCanvas ??= document.createElement('canvas');
  return measurementCanvas.getContext('2d');
};

const readCachedWidth = (cacheKey: string) => {
  const cachedWidth = measurementCache.get(cacheKey);
  if (cachedWidth === undefined) return undefined;

  // Map 保持插入顺序，命中后刷新顺序即可作为轻量 LRU，避免长时间使用后缓存无界增长。
  measurementCache.delete(cacheKey);
  measurementCache.set(cacheKey, cachedWidth);
  return cachedWidth;
};

const writeCachedWidth = (cacheKey: string, width: number) => {
  if (measurementCache.size >= MAX_TEXT_MEASUREMENT_CACHE_SIZE) {
    const oldestKey = measurementCache.keys().next().value;
    if (oldestKey !== undefined) {
      measurementCache.delete(oldestKey);
    }
  }

  measurementCache.set(cacheKey, width);
};

export const measureCachedTextWidth = (
  text: string,
  font: string,
  letterSpacing = 0,
) => {
  const cacheKey = `${font}|${letterSpacing}|${text}`;
  const cachedWidth = readCachedWidth(cacheKey);
  if (cachedWidth !== undefined) return cachedWidth;

  const context = getMeasurementContext();
  if (!context) return text.length * 8;

  context.font = font;
  const textWidth = context.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
  writeCachedWidth(cacheKey, textWidth);
  return textWidth;
};

export const clearTextMeasurementCache = () => {
  measurementCache.clear();
};
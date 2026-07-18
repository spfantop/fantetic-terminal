export type ResizeEdge =
  | 'right'
  | 'bottom'
  | 'left'
  | 'top'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left';

export interface ResizeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ResolveResizeGeometryOptions {
  edge: ResizeEdge;
  startRect: ResizeRect;
  deltaX: number;
  deltaY: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

const clamp = (value: number, minimum: number, maximum: number) => (
  Math.max(minimum, Math.min(maximum, value))
);

export const resolveResizeGeometry = ({
  edge,
  startRect,
  deltaX,
  deltaY,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
}: ResolveResizeGeometryOptions): ResizeRect => {
  const resizesLeft = edge.includes('left');
  const resizesRight = edge.includes('right');
  const resizesTop = edge.includes('top');
  const resizesBottom = edge.includes('bottom');

  const desiredWidth = resizesLeft
    ? startRect.width - deltaX
    : resizesRight
      ? startRect.width + deltaX
      : startRect.width;
  const desiredHeight = resizesTop
    ? startRect.height - deltaY
    : resizesBottom
      ? startRect.height + deltaY
      : startRect.height;
  const width = clamp(desiredWidth, minWidth, maxWidth);
  const height = clamp(desiredHeight, minHeight, maxHeight);

  return {
    // 左/上边缘缩放时固定相对边缘，避免内容朝鼠标反方向漂移。
    left: resizesLeft ? startRect.left + startRect.width - width : startRect.left,
    top: resizesTop ? startRect.top + startRect.height - height : startRect.top,
    width,
    height,
  };
};

export const isPointOnResizeEdge = (
  rect: ResizeRect,
  clientX: number,
  clientY: number,
  threshold: number,
) => (
  Math.abs(clientX - rect.left) < threshold
  || Math.abs(clientX - (rect.left + rect.width)) < threshold
  || Math.abs(clientY - rect.top) < threshold
  || Math.abs(clientY - (rect.top + rect.height)) < threshold
);

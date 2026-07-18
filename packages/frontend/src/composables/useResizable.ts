import { ref, onMounted, onBeforeUnmount, type Ref, watch } from 'vue';
import {
  resolveResizeGeometry,
  type ResizeEdge,
  type ResizeRect,
} from '../utils/resizeGeometry';

export interface UseResizableOptions {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number | (() => number);
  maxHeight?: number | (() => number);
  edgeThreshold?: number; // How close to an edge to consider it a drag handle
  initialWidth?: number | string; // Allow string for % or vh/vw, or number for px
  initialHeight?: number | string; // Allow string for % or vh/vw, or number for px
}

type Edge = ResizeEdge | null;

export function useResizable(
  elementRef: Ref<HTMLElement | null>,
  options: UseResizableOptions = {}
) {
  const {
    minWidth = 100, // Default min width
    minHeight = 100, // Default min height
    maxWidth = Infinity,
    maxHeight = Infinity,
    edgeThreshold = 8, // pixels, sensitivity for edge detection
  } = options;

  const width = ref<number | null>(null);
  const height = ref<number | null>(null);
  const isResizing = ref(false);
  const currentEdge = ref<Edge>(null);

  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let startLeft = 0;
  let startTop = 0;
  let canAnchorLeft = false;
  let canAnchorTop = false;
  let resizeFrameId: number | null = null;
  let pendingGeometry: ResizeRect | null = null;
  let activeResizeWindow: Window | null = null;

  const resolveMaxWidth = () => (
    typeof maxWidth === 'function' ? maxWidth() : maxWidth
  );

  const resolveMaxHeight = () => (
    typeof maxHeight === 'function' ? maxHeight() : maxHeight
  );

  const getEdge = (event: MouseEvent, el: HTMLElement): Edge => {
    const rect = el.getBoundingClientRect();
    const { clientX, clientY } = event;

    // Check corners first
    const onRight = Math.abs(clientX - rect.right) < edgeThreshold;
    const onLeft = Math.abs(clientX - rect.left) < edgeThreshold;
    const onBottom = Math.abs(clientY - rect.bottom) < edgeThreshold;
    const onTop = Math.abs(clientY - rect.top) < edgeThreshold;

    if (onRight && onBottom) return 'bottom-right';
    if (onLeft && onBottom) return 'bottom-left';
    if (onRight && onTop) return 'top-right';
    if (onLeft && onTop) return 'top-left';
    if (onRight) return 'right';
    if (onLeft) return 'left';
    if (onBottom) return 'bottom';
    if (onTop) return 'top';
    
    return null;
  };
  
  const updateCursorStyle = (el: HTMLElement, edge: Edge) => {
    if (edge === 'left' || edge === 'right') el.style.cursor = 'ew-resize';
    else if (edge === 'top' || edge === 'bottom') el.style.cursor = 'ns-resize';
    else if (edge === 'top-left' || edge === 'bottom-right') el.style.cursor = 'nwse-resize';
    else if (edge === 'top-right' || edge === 'bottom-left') el.style.cursor = 'nesw-resize';
    else el.style.cursor = 'default';
  };

  const applyPendingGeometry = () => {
    resizeFrameId = null;
    if (!pendingGeometry) return;

    width.value = pendingGeometry.width;
    height.value = pendingGeometry.height;
    if (elementRef.value) {
      elementRef.value.style.width = `${pendingGeometry.width}px`;
      elementRef.value.style.height = `${pendingGeometry.height}px`;
      if (canAnchorLeft && currentEdge.value?.includes('left')) {
        elementRef.value.style.left = `${pendingGeometry.left}px`;
      }
      if (canAnchorTop && currentEdge.value?.includes('top')) {
        elementRef.value.style.top = `${pendingGeometry.top}px`;
      }
    }
    pendingGeometry = null;
  };

  const scheduleGeometryUpdate = (geometry: ResizeRect) => {
    pendingGeometry = geometry;
    if (resizeFrameId !== null) return;

    const targetWindow = elementRef.value?.ownerDocument.defaultView ?? window;
    resizeFrameId = targetWindow.requestAnimationFrame(applyPendingGeometry);
  };

  const flushPendingGeometry = () => {
    if (resizeFrameId !== null) {
      const targetWindow = activeResizeWindow ?? elementRef.value?.ownerDocument.defaultView ?? window;
      targetWindow.cancelAnimationFrame(resizeFrameId);
      resizeFrameId = null;
    }
    applyPendingGeometry();
  };

  const handleMouseDown = (event: MouseEvent) => {
    if (!elementRef.value) return;
    const edge = getEdge(event, elementRef.value);

    if (!edge) return;
    event.preventDefault(); // Prevent text selection, etc.

    isResizing.value = true;
    currentEdge.value = edge;
    startX = event.clientX;
    startY = event.clientY;

    // Ensure width and height refs have current dimensions
    const rect = elementRef.value.getBoundingClientRect();
    startWidth = rect.width;
    startHeight = rect.height;
    const computedStyle = (elementRef.value.ownerDocument.defaultView ?? window).getComputedStyle(elementRef.value);
    const inlineLeft = Number.parseFloat(elementRef.value.style.left);
    const inlineTop = Number.parseFloat(elementRef.value.style.top);
    const canPositionElement = computedStyle.position === 'absolute' || computedStyle.position === 'fixed';
    canAnchorLeft = canPositionElement && Number.isFinite(inlineLeft);
    canAnchorTop = canPositionElement && Number.isFinite(inlineTop);
    startLeft = canAnchorLeft ? inlineLeft : rect.left;
    startTop = canAnchorTop ? inlineTop : rect.top;
    width.value = startWidth;
    height.value = startHeight;
    
    elementRef.value.style.userSelect = 'none'; // Prevent text selection

    activeResizeWindow = elementRef.value.ownerDocument.defaultView ?? window;
    activeResizeWindow.addEventListener('mousemove', handleMouseMove);
    activeResizeWindow.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isResizing.value || !elementRef.value || !currentEdge.value) return;
    event.preventDefault();

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    scheduleGeometryUpdate(resolveResizeGeometry({
      edge: currentEdge.value,
      startRect: {
        left: startLeft,
        top: startTop,
        width: startWidth,
        height: startHeight,
      },
      deltaX,
      deltaY,
      minWidth,
      minHeight,
      maxWidth: resolveMaxWidth(),
      maxHeight: resolveMaxHeight(),
    }));
  };

  const handleMouseUp = () => {
    if (!isResizing.value) return;
    flushPendingGeometry();
    isResizing.value = false;
    if (elementRef.value) {
        elementRef.value.style.userSelect = '';
        updateCursorStyle(elementRef.value, null); // Reset to default or hover state
    }
    activeResizeWindow?.removeEventListener('mousemove', handleMouseMove);
    activeResizeWindow?.removeEventListener('mouseup', handleMouseUp);
    activeResizeWindow = null;
  };

  const handleElementHover = (event: MouseEvent) => {
    if (!elementRef.value || isResizing.value) return;
    const edge = getEdge(event, elementRef.value);
    updateCursorStyle(elementRef.value, edge);
  };

  const handleMouseLeave = () => {
    if (!isResizing.value && elementRef.value) {
      elementRef.value.style.cursor = 'default';
    }
  };

  onMounted(() => {
    if (elementRef.value) {
      const el = elementRef.value;
      // Initialize width and height from element's current computed size
      // This ensures that initial CSS (like %, vw, vh, or fixed values) is respected
      const targetWindow = el.ownerDocument.defaultView ?? window;
      const computedStyle = targetWindow.getComputedStyle(el);
      let parsedWidth = parseFloat(computedStyle.width);
      let parsedHeight = parseFloat(computedStyle.height);

      // Fallback to minWidth/minHeight if parsing results in NaN, or ensure value is at least minWidth/minHeight
      width.value = isNaN(parsedWidth) ? minWidth : Math.max(minWidth, parsedWidth);
      height.value = isNaN(parsedHeight) ? minHeight : Math.max(minHeight, parsedHeight);

      el.addEventListener('mousedown', handleMouseDown);
      el.addEventListener('mousemove', handleElementHover); // For cursor changes
      // Reset cursor when mouse leaves the element
      el.addEventListener('mouseleave', handleMouseLeave);
    }
  });

  onBeforeUnmount(() => {
    if (resizeFrameId !== null) {
      const targetWindow = activeResizeWindow ?? elementRef.value?.ownerDocument.defaultView ?? window;
      targetWindow.cancelAnimationFrame(resizeFrameId);
      resizeFrameId = null;
    }
    pendingGeometry = null;
    if (elementRef.value) {
      elementRef.value.removeEventListener('mousedown', handleMouseDown);
      elementRef.value.removeEventListener('mousemove', handleElementHover);
      elementRef.value.removeEventListener('mouseleave', handleMouseLeave);
    }
    activeResizeWindow?.removeEventListener('mousemove', handleMouseMove); // Cleanup just in case
    activeResizeWindow?.removeEventListener('mouseup', handleMouseUp);     // Cleanup just in case
    activeResizeWindow = null;
  });
  
  // Watch for external changes to elementRef if it can become null
  watch(elementRef, (newEl, oldEl) => {
    if (oldEl) {
      oldEl.removeEventListener('mousedown', handleMouseDown);
      oldEl.removeEventListener('mousemove', handleElementHover);
      oldEl.removeEventListener('mouseleave', handleMouseLeave);
    }
    if (newEl) {
      const targetWindow = newEl.ownerDocument.defaultView ?? window;
      const computedStyle = targetWindow.getComputedStyle(newEl);
      let parsedWidth = parseFloat(computedStyle.width);
      let parsedHeight = parseFloat(computedStyle.height);

      // Fallback to minWidth/minHeight if parsing results in NaN, or ensure value is at least minWidth/minHeight
      width.value = isNaN(parsedWidth) ? minWidth : Math.max(minWidth, parsedWidth);
      height.value = isNaN(parsedHeight) ? minHeight : Math.max(minHeight, parsedHeight);

      newEl.addEventListener('mousedown', handleMouseDown);
      newEl.addEventListener('mousemove', handleElementHover);
      newEl.addEventListener('mouseleave', handleMouseLeave);
    }
  });

  return {
    width,
    height,
    isResizing,
  };
}

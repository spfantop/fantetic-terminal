import { ref, onMounted, onBeforeUnmount, type Ref, watch } from 'vue';

export interface UseResizableOptions {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number | (() => number);
  maxHeight?: number | (() => number);
  edgeThreshold?: number; // How close to an edge to consider it a drag handle
  initialWidth?: number | string; // Allow string for % or vh/vw, or number for px
  initialHeight?: number | string; // Allow string for % or vh/vw, or number for px
}

type Edge = 'right' | 'bottom' | 'left' | 'top' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | null;

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
  let resizeFrameId: number | null = null;
  let pendingSize: { width: number; height: number } | null = null;
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

  const applyPendingSize = () => {
    resizeFrameId = null;
    if (!pendingSize) return;

    width.value = pendingSize.width;
    height.value = pendingSize.height;
    if (elementRef.value) {
      elementRef.value.style.width = `${pendingSize.width}px`;
      elementRef.value.style.height = `${pendingSize.height}px`;
    }
    pendingSize = null;
  };

  const scheduleSizeUpdate = (nextWidth: number, nextHeight: number) => {
    pendingSize = { width: nextWidth, height: nextHeight };
    if (resizeFrameId !== null) return;

    const targetWindow = elementRef.value?.ownerDocument.defaultView ?? window;
    resizeFrameId = targetWindow.requestAnimationFrame(applyPendingSize);
  };

  const flushPendingSize = () => {
    if (resizeFrameId !== null) {
      const targetWindow = activeResizeWindow ?? elementRef.value?.ownerDocument.defaultView ?? window;
      targetWindow.cancelAnimationFrame(resizeFrameId);
      resizeFrameId = null;
    }
    applyPendingSize();
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

    let newWidth = width.value ?? startWidth;
    let newHeight = height.value ?? startHeight;

    if (currentEdge.value.includes('right')) {
      newWidth = startWidth + deltaX;
    }
    if (currentEdge.value.includes('left')) {
      newWidth = startWidth - deltaX;
    }
    if (currentEdge.value.includes('bottom')) {
      newHeight = startHeight + deltaY;
    }
    if (currentEdge.value.includes('top')) {
      newHeight = startHeight - deltaY;
    }

    // Apply constraints
    scheduleSizeUpdate(
      Math.max(minWidth, Math.min(resolveMaxWidth(), newWidth)),
      Math.max(minHeight, Math.min(resolveMaxHeight(), newHeight)),
    );
  };

  const handleMouseUp = () => {
    if (!isResizing.value) return;
    flushPendingSize();
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
    pendingSize = null;
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

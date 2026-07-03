import { ref, onMounted, onUnmounted, type Ref, watch } from 'vue'; // +++ Import watch +++
import { beginGlobalDragSelectionGuard } from './useGlobalDragSelectionGuard';
import { debugLog } from './useDebugLog';

interface UseSidebarResizeOptions {
  sidebarRef: Ref<HTMLElement | null>;
  handleRef: Ref<HTMLElement | null>;
  side: 'left' | 'right';
  minWidth?: number;
  maxWidth?: number;
  onResizeEnd?: (newWidth: number) => void;
}

export function useSidebarResize({
  sidebarRef,
  handleRef,
  side,
  minWidth = 200, // 默认最小宽度
  maxWidth = 800, // 默认最大宽度
  onResizeEnd,
}: UseSidebarResizeOptions) {
  const isDragging = ref(false);
  const startX = ref(0);
  const startWidth = ref(0);
  let releaseDragSelectionGuard: (() => void) | null = null;
  let resizeFrameId: number | null = null;
  let pendingWidth: number | null = null;

  const applyPendingWidth = () => {
    resizeFrameId = null;
    if (!sidebarRef.value || pendingWidth === null) return;

    sidebarRef.value.style.width = `${pendingWidth}px`;
    pendingWidth = null;
  };

  const scheduleWidthUpdate = (width: number) => {
    pendingWidth = width;
    if (resizeFrameId !== null) return;

    resizeFrameId = window.requestAnimationFrame(applyPendingWidth);
  };

  const flushPendingWidth = () => {
    if (resizeFrameId !== null) {
      window.cancelAnimationFrame(resizeFrameId);
      resizeFrameId = null;
    }
    applyPendingWidth();
  };

  const handleMouseDown = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    debugLog(`[useSidebarResize] handleMouseDown triggered for side: ${side}`, { sidebar: sidebarRef.value, handle: handleRef.value }); // +++ Add Log +++
    if (!sidebarRef.value || !handleRef.value) {
       debugLog('[useSidebarResize] MouseDown ignored: sidebarRef or handleRef is null.');
       return;
    }

    isDragging.value = true;
    startX.value = event.clientX;
    startWidth.value = sidebarRef.value.offsetWidth;
    releaseDragSelectionGuard = beginGlobalDragSelectionGuard('col-resize');

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isDragging.value || !sidebarRef.value) return;
    event.preventDefault();

    const currentX = event.clientX;
    const deltaX = currentX - startX.value;
    let newWidth: number;

    if (side === 'left') {
      newWidth = startWidth.value + deltaX;
    } else { // side === 'right'
      newWidth = startWidth.value - deltaX;
    }

    // 应用宽度限制
    newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

    scheduleWidthUpdate(newWidth);
  };

  const handleMouseUp = () => {
    if (!isDragging.value) return;

    flushPendingWidth();
    isDragging.value = false;
    releaseDragSelectionGuard?.();
    releaseDragSelectionGuard = null;

    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    if (sidebarRef.value && onResizeEnd) {
      onResizeEnd(sidebarRef.value.offsetWidth); // 传递最终宽度
    }
  };

  // 使用 watch 监视 handleRef 的变化
  watch(handleRef, (newHandle, oldHandle) => {
    // 移除旧句柄上的监听器（如果存在）
    if (oldHandle) {
      oldHandle.removeEventListener('mousedown', handleMouseDown);
    }
    // 在新句柄上添加监听器（如果存在）
    if (newHandle) {
      newHandle.addEventListener('mousedown', handleMouseDown);
    }
  }, { immediate: true }); // immediate: true 确保初始时也能尝试附加

  onUnmounted(() => {
    // 组件卸载时确保移除监听器
    if (handleRef.value) {
      handleRef.value.removeEventListener('mousedown', handleMouseDown);
    }
    // 清理可能残留的全局监听器
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    if (resizeFrameId !== null) {
      window.cancelAnimationFrame(resizeFrameId);
      resizeFrameId = null;
    }
    pendingWidth = null;
    releaseDragSelectionGuard?.();
    releaseDragSelectionGuard = null;
  });

  // 返回 isDragging 状态，可能用于 UI 反馈
  return { isDragging };
}

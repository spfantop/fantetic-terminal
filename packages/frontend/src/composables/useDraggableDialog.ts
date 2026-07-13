import { nextTick, onBeforeUnmount, type Ref } from 'vue';
import { useResizable, type UseResizableOptions } from './useResizable';

type DisabledResolver = boolean | Ref<boolean> | (() => boolean);

interface DraggableDialogOptions {
  rootRef: Ref<HTMLElement | null>;
  dialogRef: Ref<HTMLElement | null>;
  disabled?: DisabledResolver;
  margin?: number;
  resizable?: boolean | UseResizableOptions;
}

interface DragState {
  pointerId: number | null;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  handle: HTMLElement | null;
}

export function useDraggableDialog(options: DraggableDialogOptions) {
  const margin = options.margin ?? 8;
  const isResizableEnabled = options.resizable !== false;
  const resizeState = isResizableEnabled
    ? useResizable(options.dialogRef, typeof options.resizable === 'object' ? options.resizable : {})
    : null;
  let dragState: DragState | null = null;
  let previousUserSelect = '';
  let activeDragDocument: Document | null = null;
  let activeDragWindow: Window | null = null;

  const isDisabled = () => {
    const disabled = options.disabled;
    if (typeof disabled === 'function') return disabled();
    if (typeof disabled === 'object' && disabled !== null && 'value' in disabled) return disabled.value;
    return disabled === true;
  };

  const clampPosition = (left: number, top: number) => {
    const root = options.rootRef.value;
    const dialog = options.dialogRef.value;
    if (!root || !dialog) return { left, top };

    const rootRect = root.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const minLeft = margin;
    const minTop = margin;
    const maxLeft = Math.max(minLeft, rootRect.width - dialogRect.width - margin);
    const maxTop = Math.max(minTop, rootRect.height - dialogRect.height - margin);

    return {
      left: Math.min(Math.max(left, minLeft), maxLeft),
      top: Math.min(Math.max(top, minTop), maxTop),
    };
  };

  const setPosition = (left: number, top: number) => {
    const dialog = options.dialogRef.value;
    if (!dialog) return;

    const nextPosition = clampPosition(left, top);
    dialog.style.position = 'absolute';
    dialog.style.margin = '0';
    dialog.style.left = `${nextPosition.left}px`;
    dialog.style.top = `${nextPosition.top}px`;
    dialog.style.transform = 'none';
  };

  const ensurePositioned = () => {
    const root = options.rootRef.value;
    const dialog = options.dialogRef.value;
    if (!root || !dialog) return;

    const rootRect = root.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const currentLeft = Number.parseFloat(dialog.style.left);
    const currentTop = Number.parseFloat(dialog.style.top);

    if (Number.isFinite(currentLeft) && Number.isFinite(currentTop)) {
      setPosition(currentLeft, currentTop);
      return;
    }

    setPosition(dialogRect.left - rootRect.left, dialogRect.top - rootRect.top);
  };

  const centerDialog = async () => {
    await nextTick();
    const root = options.rootRef.value;
    const dialog = options.dialogRef.value;
    if (!root || !dialog) return;

    const rootRect = root.getBoundingClientRect();
    const left = (rootRect.width - dialog.offsetWidth) / 2;
    const top = (rootRect.height - dialog.offsetHeight) / 2;
    setPosition(left, top);
  };

  const stopDialogDrag = () => {
    if (!dragState) return;

    if (dragState.handle && dragState.pointerId !== null) {
      try {
        dragState.handle.releasePointerCapture(dragState.pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
    }

    activeDragWindow?.removeEventListener('pointermove', handlePointerMove);
    activeDragWindow?.removeEventListener('pointerup', stopDialogDrag);
    activeDragWindow?.removeEventListener('pointercancel', stopDialogDrag);
    if (activeDragDocument) {
      activeDragDocument.body.style.userSelect = previousUserSelect;
    }
    activeDragDocument = null;
    activeDragWindow = null;
    dragState = null;
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!dragState) return;
    if (dragState.pointerId !== null && event.pointerId !== dragState.pointerId) return;

    const left = dragState.startLeft + event.clientX - dragState.startX;
    const top = dragState.startTop + event.clientY - dragState.startY;
    setPosition(left, top);
  };

  const startDialogDrag = (event: PointerEvent) => {
    if (isDisabled() || event.button !== 0) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select, [role="button"], [data-dialog-no-drag]')) {
      return;
    }

    const dialog = options.dialogRef.value;
    if (!dialog) return;

    ensurePositioned();

    const left = Number.parseFloat(dialog.style.left) || 0;
    const top = Number.parseFloat(dialog.style.top) || 0;
    const handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;

    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: left,
      startTop: top,
      handle,
    };

    if (handle) {
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Some browsers disallow pointer capture for detached targets.
      }
    }

    activeDragDocument = dialog.ownerDocument;
    activeDragWindow = activeDragDocument.defaultView ?? window;
    previousUserSelect = activeDragDocument.body.style.userSelect;
    activeDragDocument.body.style.userSelect = 'none';
    activeDragWindow.addEventListener('pointermove', handlePointerMove);
    activeDragWindow.addEventListener('pointerup', stopDialogDrag);
    activeDragWindow.addEventListener('pointercancel', stopDialogDrag);
    event.preventDefault();
  };

  onBeforeUnmount(stopDialogDrag);

  return {
    centerDialog,
    startDialogDrag,
    stopDialogDrag,
    isResizing: resizeState?.isResizing,
  };
}

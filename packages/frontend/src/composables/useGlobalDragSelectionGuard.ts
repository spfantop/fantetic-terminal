const DRAGGING_CLASS = 'fantetic-global-dragging';

let activeGuardCount = 0;
let previousCursor = '';
let previousUserSelect = '';
let previousWebkitUserSelect = '';

const preventSelection = (event: Event) => {
  event.preventDefault();
};

const clearCurrentSelection = () => {
  window.getSelection()?.removeAllRanges();
};

export const beginGlobalDragSelectionGuard = (cursor = '') => {
  if (typeof document === 'undefined') return () => {};

  let released = false;
  const bodyStyle = document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string };

  if (activeGuardCount === 0) {
    previousCursor = bodyStyle.cursor;
    previousUserSelect = bodyStyle.userSelect;
    previousWebkitUserSelect = bodyStyle.webkitUserSelect ?? '';
    document.addEventListener('selectstart', preventSelection, true);
    document.addEventListener('dragstart', preventSelection, true);
  }

  activeGuardCount += 1;
  document.body.classList.add(DRAGGING_CLASS);
  if (cursor) bodyStyle.cursor = cursor;
  bodyStyle.userSelect = 'none';
  bodyStyle.webkitUserSelect = 'none';
  clearCurrentSelection();

  return () => {
    if (released) return;
    released = true;
    activeGuardCount = Math.max(0, activeGuardCount - 1);

    if (activeGuardCount > 0) {
      clearCurrentSelection();
      return;
    }

    document.body.classList.remove(DRAGGING_CLASS);
    document.removeEventListener('selectstart', preventSelection, true);
    document.removeEventListener('dragstart', preventSelection, true);
    bodyStyle.cursor = previousCursor;
    bodyStyle.userSelect = previousUserSelect;
    bodyStyle.webkitUserSelect = previousWebkitUserSelect;
    clearCurrentSelection();
  };
};

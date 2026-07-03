const DRAGGING_CLASS = 'fantetic-global-dragging';

type DragSelectionGuardState = {
  activeGuardCount: number;
  previousCursor: string;
  previousUserSelect: string;
  previousWebkitUserSelect: string;
};

const guardStateByDocument = new WeakMap<Document, DragSelectionGuardState>();

const preventSelection = (event: Event) => {
  event.preventDefault();
};

const readGuardState = (targetDocument: Document) => {
  let state = guardStateByDocument.get(targetDocument);
  if (!state) {
    state = {
      activeGuardCount: 0,
      previousCursor: '',
      previousUserSelect: '',
      previousWebkitUserSelect: '',
    };
    guardStateByDocument.set(targetDocument, state);
  }
  return state;
};

const clearCurrentSelection = (targetDocument: Document) => {
  targetDocument.defaultView?.getSelection()?.removeAllRanges();
};

export const beginGlobalDragSelectionGuard = (cursor = '', targetDocument?: Document) => {
  const guardDocument = targetDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!guardDocument?.body) return () => {};

  let released = false;
  const state = readGuardState(guardDocument);
  const bodyStyle = guardDocument.body.style as CSSStyleDeclaration & { webkitUserSelect?: string };

  if (state.activeGuardCount === 0) {
    state.previousCursor = bodyStyle.cursor;
    state.previousUserSelect = bodyStyle.userSelect;
    state.previousWebkitUserSelect = bodyStyle.webkitUserSelect ?? '';
    guardDocument.addEventListener('selectstart', preventSelection, true);
    guardDocument.addEventListener('dragstart', preventSelection, true);
  }

  state.activeGuardCount += 1;
  guardDocument.body.classList.add(DRAGGING_CLASS);
  if (cursor) bodyStyle.cursor = cursor;
  bodyStyle.userSelect = 'none';
  bodyStyle.webkitUserSelect = 'none';
  clearCurrentSelection(guardDocument);

  return () => {
    if (released) return;
    released = true;
    state.activeGuardCount = Math.max(0, state.activeGuardCount - 1);

    if (state.activeGuardCount > 0) {
      clearCurrentSelection(guardDocument);
      return;
    }

    guardDocument.body.classList.remove(DRAGGING_CLASS);
    guardDocument.removeEventListener('selectstart', preventSelection, true);
    guardDocument.removeEventListener('dragstart', preventSelection, true);
    bodyStyle.cursor = state.previousCursor;
    bodyStyle.userSelect = state.previousUserSelect;
    bodyStyle.webkitUserSelect = state.previousWebkitUserSelect;
    clearCurrentSelection(guardDocument);
  };
};
import type { RemotePointerState } from './remotePointer';

export interface RemoteTouchInput {
  onmousemove: ((state: RemotePointerState) => void) | null;
  onmousedown: ((state: RemotePointerState) => void) | null;
  onmouseup: ((state: RemotePointerState) => void) | null;
}

export type RemoteMouseStateSender = (
  state: RemotePointerState,
  applyDisplayScale?: boolean,
) => void;

export const supportsTouchInput = (displayElement: HTMLElement) => {
  const displayWindow = displayElement.ownerDocument.defaultView;
  return Boolean(
    displayWindow
    && ('ontouchstart' in displayWindow || displayWindow.navigator.maxTouchPoints > 0),
  );
};

export const bindRemoteTouchInput = (
  touchInput: RemoteTouchInput,
  sendMouseState: RemoteMouseStateSender,
) => {
  const forwardTouchState = (state: RemotePointerState) => {
    sendMouseState(state, true);
  };

  touchInput.onmousemove = forwardTouchState;
  touchInput.onmousedown = forwardTouchState;
  touchInput.onmouseup = forwardTouchState;

  return () => {
    if (touchInput.onmousemove === forwardTouchState) touchInput.onmousemove = null;
    if (touchInput.onmousedown === forwardTouchState) touchInput.onmousedown = null;
    if (touchInput.onmouseup === forwardTouchState) touchInput.onmouseup = null;
  };
};

export interface RemotePointerState {
  x: number;
  y: number;
  [key: string]: unknown;
}

interface AnimationFrameAdapter {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(frameId: number): void;
}

export const createRemotePointerScheduler = <T extends RemotePointerState>({
  send,
  animationFrame,
}: {
  send: (state: T) => void;
  animationFrame: AnimationFrameAdapter;
}) => {
  let pendingMove: T | null = null;
  let frameId: number | null = null;
  let disposed = false;

  const snapshot = (state: T): T => ({ ...state });

  const sendPendingMove = (): void => {
    const state = pendingMove;
    pendingMove = null;
    if (state && !disposed) send(state);
  };

  const cancelFrame = (): void => {
    if (frameId === null) return;
    animationFrame.cancelAnimationFrame(frameId);
    frameId = null;
  };

  const move = (state: T): void => {
    if (disposed) return;
    pendingMove = snapshot(state);
    if (frameId !== null) return;
    frameId = animationFrame.requestAnimationFrame(() => {
      frameId = null;
      sendPendingMove();
    });
  };

  const sendNow = (state: T): void => {
    if (disposed) return;
    cancelFrame();
    sendPendingMove();
    send(snapshot(state));
  };

  const dispose = (): void => {
    disposed = true;
    cancelFrame();
    pendingMove = null;
  };

  return { dispose, move, sendNow };
};

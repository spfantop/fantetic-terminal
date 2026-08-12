interface WebSocketSessionCleanupSteps {
  clearOutput: () => void;
  clearInput: () => void;
  finishRecording: () => Promise<void>;
  stopStatusPolling: () => void;
  cleanupSftp: () => void;
  disconnectTelnet: () => void;
  resolveSshOwnership: () => Promise<void>;
  stopDockerPolling: () => void;
  detachState: () => void;
}

export class WebSocketSessionCleanupError extends Error {
  constructor(public readonly errors: unknown[]) {
    super(`Failed to clean up ${errors.length} WebSocket session resource(s).`);
    this.name = 'WebSocketSessionCleanupError';
  }
}

export const runWebSocketSessionCleanup = async (
  steps: WebSocketSessionCleanupSteps,
): Promise<void> => {
  const errorList: unknown[] = [];
  const attempt = async (operation: () => void | Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      errorList.push(error);
    }
  };

  await attempt(steps.clearOutput);
  await attempt(steps.clearInput);
  await attempt(steps.finishRecording);
  await attempt(steps.stopStatusPolling);
  await attempt(steps.cleanupSftp);
  await attempt(steps.disconnectTelnet);
  await attempt(steps.resolveSshOwnership);
  await attempt(steps.stopDockerPolling);
  await attempt(steps.detachState);

  if (errorList.length > 0) throw new WebSocketSessionCleanupError(errorList);
};

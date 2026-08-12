export interface WebSocketRuntimeLifecycleDependencies {
  listSessionIds: () => string[];
  cleanupSession: (sessionId: string) => Promise<void>;
  stopHeartbeat: () => void;
  disposeStatusMonitor: () => void;
}

export interface WebSocketRuntimeLifecycle {
  drain: () => Promise<void>;
}

export interface ClosableWebSocketRuntime {
  clients: Iterable<{ terminate: () => void }>;
  drainSessions: () => Promise<void>;
  close: (callback: (error?: Error) => void) => void;
}

export class WebSocketRuntimeDrainError extends Error {
  constructor(public readonly errors: unknown[]) {
    super(`Failed to clean up ${errors.length} WebSocket session(s).`);
    this.name = 'WebSocketRuntimeDrainError';
  }
}

export class WebSocketRuntimeCloseError extends Error {
  constructor(public readonly errors: unknown[]) {
    super('Failed to drain and close WebSocket runtime.');
    this.name = 'WebSocketRuntimeCloseError';
  }
}

export const createWebSocketRuntimeLifecycle = (
  dependencies: WebSocketRuntimeLifecycleDependencies,
): WebSocketRuntimeLifecycle => {
  let drainPromise: Promise<void> | null = null;

  const drain = (): Promise<void> => {
    if (drainPromise) return drainPromise;

    drainPromise = (async () => {
      dependencies.stopHeartbeat();
      dependencies.disposeStatusMonitor();

      const sessionIdList = dependencies.listSessionIds();
      const cleanupResultList = await Promise.allSettled(
        sessionIdList.map(sessionId => dependencies.cleanupSession(sessionId)),
      );
      const errorList = cleanupResultList
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason);
      if (errorList.length > 0) {
        throw new WebSocketRuntimeDrainError(errorList);
      }
    })();

    return drainPromise;
  };

  return { drain };
};

export const closeWebSocketRuntime = async (runtime: ClosableWebSocketRuntime): Promise<void> => {
  for (const client of runtime.clients) client.terminate();

  const errorList: unknown[] = [];
  try {
    await runtime.drainSessions();
  } catch (error) {
    errorList.push(error);
  }

  try {
    await new Promise<void>((resolve, reject) => runtime.close(error => error ? reject(error) : resolve()));
  } catch (error) {
    errorList.push(error);
  }

  if (errorList.length === 1) throw errorList[0];
  if (errorList.length > 1) throw new WebSocketRuntimeCloseError(errorList);
};

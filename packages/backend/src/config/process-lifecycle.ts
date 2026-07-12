export interface ProcessLifecycleTarget {
  exitCode?: string | number;
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}

export const installProcessLifecycle = ({
  process: processTarget,
  shutdown,
  logError = console.error,
}: {
  process: ProcessLifecycleTarget;
  shutdown: (reason: string) => Promise<void>;
  logError?: (error: unknown) => void;
}) => {
  let started = false;
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });

  const begin = async (reason: string, exitCode: number, error?: unknown) => {
    if (started) return;
    started = true;
    processTarget.exitCode = exitCode;
    if (error !== undefined) logError(error);
    try {
      await shutdown(reason);
    } catch (shutdownError) {
      processTarget.exitCode = 1;
      logError(shutdownError);
    } finally {
      resolveCompletion();
    }
  };

  const onSigint = () => { void begin('SIGINT', 0); };
  const onSigterm = () => { void begin('SIGTERM', 0); };
  const onUncaughtException = (error: Error) => { void begin('uncaughtException', 1, error); };
  const onUnhandledRejection = (reason: unknown) => { void begin('unhandledRejection', 1, reason); };

  processTarget.on('SIGINT', onSigint);
  processTarget.on('SIGTERM', onSigterm);
  processTarget.on('uncaughtException', onUncaughtException);
  processTarget.on('unhandledRejection', onUnhandledRejection);

  return {
    completion,
    dispose: () => {
      processTarget.off('SIGINT', onSigint);
      processTarget.off('SIGTERM', onSigterm);
      processTarget.off('uncaughtException', onUncaughtException);
      processTarget.off('unhandledRejection', onUnhandledRejection);
    },
  };
};

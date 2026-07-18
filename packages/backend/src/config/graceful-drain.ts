export type GracefulDrainPhase = 'stop' | 'connections' | 'storage' | 'release';

export class GracefulDrainError extends Error {
  constructor(
    message: string,
    readonly errors: unknown[],
  ) {
    super(message);
    this.name = 'GracefulDrainError';
  }
}

interface DrainRegistration {
  name: string;
  phase: GracefulDrainPhase;
  cleanup: () => void | Promise<void>;
  order: number;
}

const PHASE_ORDER: Record<GracefulDrainPhase, number> = {
  stop: 0,
  connections: 1,
  storage: 2,
  release: 3,
};

export const createGracefulDrainRegistry = ({
  onCleanupError = () => undefined,
}: {
  onCleanupError?: (name: string, error: unknown) => void;
} = {}) => {
  const registrationList: DrainRegistration[] = [];
  let drainPromise: Promise<void> | null = null;

  const register = (
    phase: GracefulDrainPhase,
    name: string,
    cleanup: () => void | Promise<void>,
  ): void => {
    if (drainPromise) throw new Error('Cannot register a cleanup after graceful drain has started.');
    registrationList.push({ phase, name, cleanup, order: registrationList.length });
  };

  const drain = (reason: string): Promise<void> => {
    if (drainPromise) return drainPromise;
    drainPromise = (async () => {
      const failureList: Array<{ name: string; error: unknown }> = [];
      const orderedRegistrationList = [...registrationList].sort((left, right) =>
        PHASE_ORDER[left.phase] - PHASE_ORDER[right.phase] || left.order - right.order);

      for (const registration of orderedRegistrationList) {
        try {
          await registration.cleanup();
        } catch (error) {
          failureList.push({ name: registration.name, error });
          onCleanupError(registration.name, error);
        }
      }

      if (failureList.length > 0) {
        throw new GracefulDrainError(
          `Graceful drain failed for ${failureList.map(failure => failure.name).join(', ')} (${reason}).`,
          failureList.map(failure => failure.error),
        );
      }
    })();
    return drainPromise;
  };

  return { drain, register };
};

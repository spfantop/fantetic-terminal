export type AuthenticationExpirationReason = 'unauthorized' | 'logout' | 'password-changed';

export interface AuthenticationRuntime {
  expireSession(reason: AuthenticationExpirationReason): Promise<boolean>;
}

let installedRuntime: AuthenticationRuntime | undefined;

export const installAuthenticationRuntime = (runtime: AuthenticationRuntime): (() => void) => {
  if (installedRuntime) throw new Error('Authentication runtime is already installed.');
  installedRuntime = runtime;

  return () => {
    if (installedRuntime === runtime) installedRuntime = undefined;
  };
};

export const expireAuthenticatedSession = (
  reason: AuthenticationExpirationReason,
): Promise<boolean> => {
  if (!installedRuntime) throw new Error('Authentication runtime is not installed.');
  return installedRuntime.expireSession(reason);
};

interface AuthenticationRuntimeDependencies {
  isAccountFeatureAvailable(): boolean;
  hasAuthenticatedSession(): boolean;
  clearAuthenticatedSession(): void;
  isLoginRouteActive(): boolean;
  navigateToLogin(): Promise<unknown>;
  reportFailure(error: unknown): void;
}

export const createAuthenticationRuntime = (
  dependencies: AuthenticationRuntimeDependencies,
): AuthenticationRuntime => {
  let activeExpiration: Promise<boolean> | undefined;
  let activeExpirationReason: AuthenticationExpirationReason | undefined;
  const reportFailure = (error: unknown) => {
    try {
      dependencies.reportFailure(error);
    } catch {
      // Failure reporting is best effort; it must not interrupt session invalidation.
    }
  };

  const expireSession = async (reason: AuthenticationExpirationReason) => {
    if (!dependencies.isAccountFeatureAvailable()) {
      return false;
    }
    if (reason === 'unauthorized' && !dependencies.hasAuthenticatedSession()) {
      return false;
    }

    try {
      dependencies.clearAuthenticatedSession();
    } catch (error) {
      reportFailure(error);
    }
    if (!dependencies.isLoginRouteActive()) {
      try {
        await dependencies.navigateToLogin();
      } catch (error) {
        reportFailure(error);
      }
    }
    return true;
  };

  const trackExpiration = (
    operation: Promise<boolean>,
    reason: AuthenticationExpirationReason,
  ): Promise<boolean> => {
    const trackedOperation = operation.finally(() => {
      if (activeExpiration !== trackedOperation) return;
      activeExpiration = undefined;
      activeExpirationReason = undefined;
    });
    activeExpiration = trackedOperation;
    activeExpirationReason = reason;
    return trackedOperation;
  };

  return {
    expireSession(reason) {
      if (!activeExpiration) {
        return trackExpiration(Promise.resolve().then(() => expireSession(reason)), reason);
      }

      const isExplicitExpiration = reason !== 'unauthorized';
      const activeExpirationIsExplicit = activeExpirationReason !== 'unauthorized';
      if (!isExplicitExpiration || activeExpirationIsExplicit) return activeExpiration;

      const precedingExpiration = activeExpiration;
      return trackExpiration(
        precedingExpiration.then(expired => expired || expireSession(reason)),
        reason,
      );
    },
  };
};

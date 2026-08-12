import assert from 'node:assert/strict';

import {
  createAuthenticationRuntime,
  expireAuthenticatedSession,
  installAuthenticationRuntime,
} from '../src/authentication-runtime';

let authenticated = true;
let clearCount = 0;
let navigationCount = 0;

const runtime = createAuthenticationRuntime({
  isAccountFeatureAvailable: () => true,
  hasAuthenticatedSession: () => authenticated,
  clearAuthenticatedSession: () => {
    authenticated = false;
    clearCount += 1;
  },
  isLoginRouteActive: () => false,
  navigateToLogin: async () => {
    navigationCount += 1;
  },
  reportFailure: () => undefined,
});

assert.equal(await runtime.expireSession('unauthorized'), true);
assert.equal(authenticated, false);
assert.equal(clearCount, 1);
assert.equal(navigationCount, 1);

const navigationFailure = new Error('navigation failed');
const reportedFailureList: unknown[] = [];
authenticated = true;
const resilientRuntime = createAuthenticationRuntime({
  isAccountFeatureAvailable: () => true,
  hasAuthenticatedSession: () => authenticated,
  clearAuthenticatedSession: () => {
    authenticated = false;
  },
  isLoginRouteActive: () => false,
  navigateToLogin: async () => {
    throw navigationFailure;
  },
  reportFailure: error => reportedFailureList.push(error),
});

assert.equal(await resilientRuntime.expireSession('unauthorized'), true);
assert.equal(authenticated, false, 'navigation failure must not restore an expired session');
assert.deepEqual(reportedFailureList, [navigationFailure]);

let resolveNavigation: (() => void) | undefined;
authenticated = true;
clearCount = 0;
navigationCount = 0;
const concurrentRuntime = createAuthenticationRuntime({
  isAccountFeatureAvailable: () => true,
  hasAuthenticatedSession: () => authenticated,
  clearAuthenticatedSession: () => {
    authenticated = false;
    clearCount += 1;
  },
  isLoginRouteActive: () => false,
  navigateToLogin: () => new Promise<void>(resolve => {
    navigationCount += 1;
    resolveNavigation = resolve;
  }),
  reportFailure: () => undefined,
});

const firstExpiration = concurrentRuntime.expireSession('unauthorized');
const secondExpiration = concurrentRuntime.expireSession('unauthorized');
let secondSettled = false;
void secondExpiration.then(() => {
  secondSettled = true;
});
await Promise.resolve();

assert.equal(secondSettled, false, 'concurrent expiration must wait for the active navigation');
assert.equal(clearCount, 1);
assert.equal(navigationCount, 1);
resolveNavigation?.();
assert.deepEqual(await Promise.all([firstExpiration, secondExpiration]), [true, true]);

assert.throws(
  () => expireAuthenticatedSession('unauthorized'),
  /Authentication runtime is not installed/,
);
const disposeRuntime = installAuthenticationRuntime(runtime);
assert.throws(
  () => installAuthenticationRuntime(runtime),
  /Authentication runtime is already installed/,
);
assert.equal(await expireAuthenticatedSession('unauthorized'), false, 'the installed runtime must serve the public facade');
disposeRuntime();
assert.throws(
  () => expireAuthenticatedSession('unauthorized'),
  /Authentication runtime is not installed/,
);

for (const scenario of [
  { name: 'desktop runtime', accountFeatureAvailable: false, authenticated: true },
  { name: 'unauthenticated web request', accountFeatureAvailable: true, authenticated: false },
]) {
  let clearAttempted = false;
  let navigationAttempted = false;
  const noOpRuntime = createAuthenticationRuntime({
    isAccountFeatureAvailable: () => scenario.accountFeatureAvailable,
    hasAuthenticatedSession: () => scenario.authenticated,
    clearAuthenticatedSession: () => {
      clearAttempted = true;
    },
    isLoginRouteActive: () => false,
    navigateToLogin: async () => {
      navigationAttempted = true;
    },
    reportFailure: () => undefined,
  });

  assert.equal(await noOpRuntime.expireSession('unauthorized'), false, scenario.name);
  assert.equal(clearAttempted, false, `${scenario.name} must preserve its session projection`);
  assert.equal(navigationAttempted, false, `${scenario.name} must not navigate`);
}

let forcedClearCount = 0;
let forcedNavigationCount = 0;
const explicitLogoutRuntime = createAuthenticationRuntime({
  isAccountFeatureAvailable: () => true,
  hasAuthenticatedSession: () => false,
  clearAuthenticatedSession: () => {
    forcedClearCount += 1;
  },
  isLoginRouteActive: () => false,
  navigateToLogin: async () => {
    forcedNavigationCount += 1;
  },
  reportFailure: () => undefined,
});

assert.equal(await explicitLogoutRuntime.expireSession('logout'), true);
assert.equal(forcedClearCount, 1, 'explicit logout must clear any remaining local projection');
assert.equal(forcedNavigationCount, 1, 'explicit logout must finish at the login route');

const clearFailure = new Error('cache cleanup failed');
const clearFailureList: unknown[] = [];
let navigationAfterClearFailure = false;
const storageResilientRuntime = createAuthenticationRuntime({
  isAccountFeatureAvailable: () => true,
  hasAuthenticatedSession: () => true,
  clearAuthenticatedSession: () => {
    throw clearFailure;
  },
  isLoginRouteActive: () => false,
  navigateToLogin: async () => {
    navigationAfterClearFailure = true;
  },
  reportFailure: error => clearFailureList.push(error),
});

assert.equal(await storageResilientRuntime.expireSession('unauthorized'), true);
assert.deepEqual(clearFailureList, [clearFailure]);
assert.equal(navigationAfterClearFailure, true, 'cache cleanup failure must not block navigation');

let lateLogoutClearCount = 0;
let lateLogoutNavigationCount = 0;
const reasonAwareRuntime = createAuthenticationRuntime({
  isAccountFeatureAvailable: () => true,
  hasAuthenticatedSession: () => false,
  clearAuthenticatedSession: () => {
    lateLogoutClearCount += 1;
  },
  isLoginRouteActive: () => false,
  navigateToLogin: async () => {
    lateLogoutNavigationCount += 1;
  },
  reportFailure: () => undefined,
});

const unauthorizedNoOp = reasonAwareRuntime.expireSession('unauthorized');
const explicitLogoutAfterNoOp = reasonAwareRuntime.expireSession('logout');
assert.deepEqual(await Promise.all([unauthorizedNoOp, explicitLogoutAfterNoOp]), [false, true]);
assert.equal(lateLogoutClearCount, 1);
assert.equal(lateLogoutNavigationCount, 1);

let navigationAfterReporterFailure = false;
const reporterResilientRuntime = createAuthenticationRuntime({
  isAccountFeatureAvailable: () => true,
  hasAuthenticatedSession: () => true,
  clearAuthenticatedSession: () => {
    throw new Error('projection cleanup failed');
  },
  isLoginRouteActive: () => false,
  navigateToLogin: async () => {
    navigationAfterReporterFailure = true;
  },
  reportFailure: () => {
    throw new Error('reporter failed');
  },
});

assert.equal(await reporterResilientRuntime.expireSession('unauthorized'), true);
assert.equal(navigationAfterReporterFailure, true, 'reporting failure must not block invalidation');

let reentrantExpiration: Promise<boolean> | undefined;
let reentrantClearCount = 0;
let reentrantRuntime: ReturnType<typeof createAuthenticationRuntime>;
reentrantRuntime = createAuthenticationRuntime({
  isAccountFeatureAvailable: () => true,
  hasAuthenticatedSession: () => true,
  clearAuthenticatedSession: () => {
    reentrantClearCount += 1;
    reentrantExpiration = reentrantRuntime.expireSession('unauthorized');
  },
  isLoginRouteActive: () => true,
  navigateToLogin: async () => undefined,
  reportFailure: () => undefined,
});

const outerExpiration = reentrantRuntime.expireSession('unauthorized');
assert.equal(await outerExpiration, true);
assert.equal(await reentrantExpiration, true);
assert.equal(reentrantClearCount, 1, 'reentrant invalidation must share the active operation');

import assert from 'node:assert/strict';

import { installAuthenticationRuntime } from '../src/authentication-runtime';

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: 'behavior-test' },
});
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    location: { protocol: 'https:', host: 'terminal.example.test' },
    addEventListener: () => undefined,
  },
});

const { default: apiClient } = await import('../src/utils/apiClient');
const originalAdapter = apiClient.defaults.adapter;
const originalConsoleError = console.error;
let disposeRuntime: (() => void) | undefined;

try {
  console.error = () => undefined;

  const assertOriginalUnauthorizedError = async () => {
    const unauthorizedError = Object.assign(new Error('unauthorized'), {
      response: { status: 401 },
    });
    apiClient.defaults.adapter = async () => Promise.reject(unauthorizedError);

    await assert.rejects(
      apiClient.get('/protected-resource'),
      error => error === unauthorizedError,
    );
  };

  await assertOriginalUnauthorizedError();

  disposeRuntime = installAuthenticationRuntime({
    async expireSession() {
      throw new Error('invalidation failed');
    },
  });
  await assertOriginalUnauthorizedError();
  disposeRuntime();
  disposeRuntime = undefined;

  let expirationCount = 0;
  disposeRuntime = installAuthenticationRuntime({
    async expireSession(reason) {
      assert.equal(reason, 'unauthorized');
      expirationCount += 1;
      return true;
    },
  });
  await assertOriginalUnauthorizedError();
  assert.equal(expirationCount, 1);
  disposeRuntime();
  disposeRuntime = undefined;
} finally {
  apiClient.defaults.adapter = originalAdapter;
  console.error = originalConsoleError;
  disposeRuntime?.();
}

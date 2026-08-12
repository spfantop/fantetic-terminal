import assert from 'node:assert/strict';

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

const { createPinia, setActivePinia } = await import('pinia');
const { installAuthenticationRuntime } = await import('../src/authentication-runtime');
const { default: apiClient } = await import('../src/utils/apiClient');
const { useAuthStore } = await import('../src/stores/auth.store');

const expirationReasonList: string[] = [];
const disposeRuntime = installAuthenticationRuntime({
  async expireSession(reason) {
    expirationReasonList.push(reason);
    return true;
  },
});
const originalAdapter = apiClient.defaults.adapter;

try {
  apiClient.defaults.adapter = async config => ({
    config,
    data: config.url === '/auth/password' ? { message: 'changed' } : { message: 'logged out' },
    headers: {},
    status: 200,
    statusText: 'OK',
  });
  setActivePinia(createPinia());
  const authStore = useAuthStore();
  authStore.isAuthenticated = true;

  assert.equal(await authStore.changePassword('old-password', 'new-password'), true);
  await authStore.logout();
  assert.deepEqual(expirationReasonList, ['password-changed', 'logout']);
} finally {
  apiClient.defaults.adapter = originalAdapter;
  disposeRuntime();
}

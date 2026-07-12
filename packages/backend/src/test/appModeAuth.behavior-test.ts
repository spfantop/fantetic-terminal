import assert from 'node:assert/strict';
import { isAuthenticated, sessionMatchesAuthenticationEpoch } from '../auth/auth.middleware';
import {
  ELECTRON_APP_USERNAME,
  ELECTRON_APP_USER_ID,
  isElectronAppMode,
  resolveRuntimeCapabilities,
} from '../config/app-mode';

const originalAppMode = process.env.FANTETIC_APP_MODE;

assert.equal(sessionMatchesAuthenticationEpoch(4, 4), true);
assert.equal(sessionMatchesAuthenticationEpoch(3, 4), false);
assert.equal(sessionMatchesAuthenticationEpoch(undefined, 0), false, 'legacy sessions must log in again');

const createResponseStub = () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };

  return response;
};

try {
  process.env.FANTETIC_APP_MODE = 'electron';
  assert.equal(isElectronAppMode(), true);
  assert.deepEqual(resolveRuntimeCapabilities(), {
    runtime: 'desktop', requiresAuthentication: false, remoteDesktop: false, multiUserAdministration: false,
  });

  const appModeRequest = { session: {} } as any;
  const appModeResponse = createResponseStub() as any;
  let appModeNextCalled = false;

  isAuthenticated(appModeRequest, appModeResponse, () => {
    appModeNextCalled = true;
  });

  assert.equal(appModeNextCalled, true);
  assert.equal(appModeRequest.session.userId, ELECTRON_APP_USER_ID);
  assert.equal(appModeRequest.session.username, ELECTRON_APP_USERNAME);
  assert.equal(appModeRequest.session.requiresTwoFactor, false);
  assert.equal(appModeResponse.statusCode, 200);

  process.env.FANTETIC_APP_MODE = 'web';
  assert.equal(isElectronAppMode(), false);
  assert.deepEqual(resolveRuntimeCapabilities(), {
    runtime: 'web', requiresAuthentication: true, remoteDesktop: true, multiUserAdministration: true,
  });

  const webRequest = { session: {} } as any;
  const webResponse = createResponseStub() as any;
  let webNextCalled = false;

  isAuthenticated(webRequest, webResponse, () => {
    webNextCalled = true;
  });

  assert.equal(webNextCalled, false);
  assert.equal(webResponse.statusCode, 401);
  assert.deepEqual(webResponse.body, { message: '未授权：请先登录。' });
} finally {
  if (typeof originalAppMode === 'undefined') {
    delete process.env.FANTETIC_APP_MODE;
  } else {
    process.env.FANTETIC_APP_MODE = originalAppMode;
  }
}

console.log('app mode auth behavior passed');

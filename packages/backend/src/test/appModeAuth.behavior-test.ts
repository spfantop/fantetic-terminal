import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { isAuthenticated, sessionMatchesAuthenticationEpoch } from '../auth/auth.middleware';
import { ensureElectronRuntimeUser } from '../config/electron-runtime-user';
import {
  ELECTRON_APP_USERNAME,
  ELECTRON_APP_USER_ID,
  isElectronAppMode,
  resolveRuntimeCapabilities,
} from '../config/app-mode';

const originalAppMode = process.env.FANTETIC_APP_MODE;
const originalElectronNonce = process.env.FANTETIC_ELECTRON_NONCE;

assert.equal(sessionMatchesAuthenticationEpoch(4, 4), true);
assert.equal(sessionMatchesAuthenticationEpoch(3, 4), false);
assert.equal(sessionMatchesAuthenticationEpoch(undefined, 0), false, 'legacy sessions must log in again');

const verifyElectronRuntimeUser = async () => {
  const runtimeUserDatabase = new sqlite3.Database(':memory:');
  await new Promise<void>((resolve, reject) => runtimeUserDatabase.run(
    `CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      hashed_password TEXT NOT NULL,
      system_role TEXT NOT NULL,
      status TEXT NOT NULL,
      auth_epoch INTEGER NOT NULL DEFAULT 0
    )`,
    error => error ? reject(error) : resolve(),
  ));
  await ensureElectronRuntimeUser(runtimeUserDatabase);
  await ensureElectronRuntimeUser(runtimeUserDatabase);
  const runtimeUser = await new Promise<any>((resolve, reject) => runtimeUserDatabase.get(
    'SELECT id, username, system_role, status FROM users WHERE id = 1',
    (error, row) => error ? reject(error) : resolve(row),
  ));
  assert.deepEqual(runtimeUser, {
    id: ELECTRON_APP_USER_ID,
    username: ELECTRON_APP_USERNAME,
    system_role: 'super_admin',
    status: 'active',
  });
  await new Promise<void>((resolve, reject) => runtimeUserDatabase.close(error => error ? reject(error) : resolve()));
};

const createResponseStub = () => {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
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
  process.env.FANTETIC_ELECTRON_NONCE = 'test-electron-runtime-nonce';
  assert.equal(isElectronAppMode(), true);
  assert.deepEqual(resolveRuntimeCapabilities(), {
    runtime: 'desktop', requiresAuthentication: false, remoteDesktop: false, multiUserAdministration: false,
  });

  const missingNonceRequest = { session: {}, headers: {} } as any;
  const missingNonceResponse = createResponseStub() as any;
  let missingNonceNextCalled = false;

  isAuthenticated(missingNonceRequest, missingNonceResponse, () => {
    missingNonceNextCalled = true;
  });

  assert.equal(missingNonceNextCalled, false);
  assert.equal(missingNonceResponse.statusCode, 401);

  const appModeRequest = {
    session: {},
    headers: { 'x-fantetic-electron-nonce': 'test-electron-runtime-nonce' },
  } as any;
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
  assert.deepEqual((webResponse.body as any)?.code, 'auth.authenticationRequired');
  assert.equal(typeof (webResponse.body as any)?.requestId, 'string');
} finally {
  if (typeof originalAppMode === 'undefined') {
    delete process.env.FANTETIC_APP_MODE;
  } else {
    process.env.FANTETIC_APP_MODE = originalAppMode;
  }
  if (typeof originalElectronNonce === 'undefined') {
    delete process.env.FANTETIC_ELECTRON_NONCE;
  } else {
    process.env.FANTETIC_ELECTRON_NONCE = originalElectronNonce;
  }
}

verifyElectronRuntimeUser().then(() => {
  console.log('app mode auth behavior passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

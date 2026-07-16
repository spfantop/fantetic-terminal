import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  readApiErrorEnvelope,
  resolveLoginErrorKey,
  resolvePasskeyErrorKey,
  resolvePasswordChangeErrorKey,
  resolveSetupErrorKey,
  resolveTwoFactorErrorKey,
} from '../src/utils/apiError';

const error = {
  response: {
    data: {
      code: 'auth.invalidCredentials',
      args: [],
      requestId: 'req-contract-1',
    },
  },
};

assert.deepEqual(readApiErrorEnvelope(error), error.response.data);
assert.equal(resolveLoginErrorKey(error), 'login.error.invalidCredentials');
assert.equal(resolveLoginErrorKey({ response: { data: { code: 'auth.twoFactorTokenInvalid', args: [], requestId: 'req-contract-2' } } }), 'login.error.twoFactorTokenInvalid');
assert.equal(resolvePasswordChangeErrorKey({ response: { data: { code: 'auth.passwordChangeCurrentPasswordInvalid', args: [], requestId: 'req-contract-3' } } }), 'settings.changePassword.error.currentPasswordInvalid');
assert.equal(resolveTwoFactorErrorKey({ response: { data: { code: 'auth.twoFactorDisablePasswordInvalid', args: [], requestId: 'req-contract-4' } } }), 'settings.twoFactor.error.currentPasswordInvalid');
assert.equal(resolvePasskeyErrorKey({ response: { data: { code: 'auth.passkeyDeleteUnauthorized', args: [], requestId: 'req-contract-5' } } }), 'settings.passkey.error.userNotLoggedIn');
assert.equal(resolveSetupErrorKey({ response: { data: { code: 'auth.setupAlreadyCompleted', args: [], requestId: 'req-contract-6' } } }), 'setup.error.alreadyCompleted');
assert.equal(resolveLoginErrorKey({ response: { data: { message: 'legacy error' } } }), 'login.error.requestFailed');

const authStoreSource = fs.readFileSync(path.resolve(process.cwd(), 'src/stores/auth.store.ts'), 'utf8');
assert.match(authStoreSource, /resolveLoginErrorKey/);
assert.doesNotMatch(authStoreSource, /err\.response\?\.data\?\.message \|\| err\.message \|\| '登录时发生未知错误。'/);
const passkeyActionSource = authStoreSource.slice(
  authStoreSource.indexOf('async loginWithPasskey'),
  authStoreSource.indexOf('async getPasskeyRegistrationOptions'),
);
assert.match(passkeyActionSource, /this\.error = resolveLoginErrorKey\(err\);/);
assert.doesNotMatch(passkeyActionSource, /err\.response\?\.data\?\.message/);

const passkeyManagementActionSource = authStoreSource.slice(
  authStoreSource.indexOf('async getPasskeyRegistrationOptions'),
  authStoreSource.indexOf('async checkHasPasskeysConfigured'),
);
assert.match(passkeyManagementActionSource, /this\.error = resolvePasskeyErrorKey\(err\);/);
assert.doesNotMatch(passkeyManagementActionSource, /err\.response\?\.data\?\.message/);

const passkeyManagementSource = fs.readFileSync(path.resolve(process.cwd(), 'src/composables/settings/usePasskeyManagement.ts'), 'utf8');
assert.match(passkeyManagementSource, /resolvePasskeyErrorKey\(error\)/);
assert.doesNotMatch(passkeyManagementSource, /response\?\.data\?\.message/);

const setupViewSource = fs.readFileSync(path.resolve(process.cwd(), 'src/views/SetupView.vue'), 'utf8');
assert.match(setupViewSource, /resolveSetupErrorKey\(err\)/);
assert.doesNotMatch(setupViewSource, /err\.response\?\.data\?\.message/);

const loginViewSource = fs.readFileSync(path.resolve(process.cwd(), 'src/views/LoginView.vue'), 'utf8');
const passkeyHandlerSource = loginViewSource.slice(
  loginViewSource.indexOf('const handlePasskeyLogin'),
  loginViewSource.indexOf('const handleRetryBootstrap'),
);
assert.doesNotMatch(passkeyHandlerSource, /err\.message/);
assert.match(passkeyHandlerSource, /const loginResult = await authStore\.loginWithPasskey/);
assert.match(passkeyHandlerSource, /if \(!loginResult\.success\)/);

const twoFactorActionSource = authStoreSource.slice(
  authStoreSource.indexOf('async verifyLogin2FA'),
  authStoreSource.indexOf('// 登出 Action'),
);
assert.match(twoFactorActionSource, /this\.error = resolveLoginErrorKey\(err\);/);
assert.doesNotMatch(twoFactorActionSource, /err\.response\?\.data\?\.message/);

const changePasswordActionSource = authStoreSource.slice(
  authStoreSource.indexOf('async changePassword'),
  authStoreSource.indexOf('// --- IP 黑名单管理 Actions ---'),
);
assert.match(changePasswordActionSource, /this\.error = resolvePasswordChangeErrorKey\(err\);/);
assert.doesNotMatch(changePasswordActionSource, /err\.response\?\.data\?\.message/);

const twoFactorComposableSource = fs.readFileSync(path.resolve(process.cwd(), 'src/composables/settings/useTwoFactorAuth.ts'), 'utf8');
assert.match(twoFactorComposableSource, /resolveTwoFactorErrorKey\(error\)/);
assert.doesNotMatch(twoFactorComposableSource, /response\?\.data\?\.message/);

console.log('api error client behavior ok');

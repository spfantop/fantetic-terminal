import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { runWithAuditContext } from '../audit/audit-context';
import { sendApiError } from '../security/api-error-envelope';

const headers = new Map<string, string>();
const response = {
  statusCode: 200,
  body: undefined as unknown,
  setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
  status(code: number) { this.statusCode = code; return this; },
  json(body: unknown) { this.body = body; return this; },
};

runWithAuditContext({ requestId: 'req-contract-1', sourceIp: '192.0.2.10' }, () => {
  sendApiError(response as any, 401, 'auth.invalidCredentials');
});

assert.equal(response.statusCode, 401);
assert.deepEqual(response.body, {
  code: 'auth.invalidCredentials',
  args: [],
  requestId: 'req-contract-1',
});
assert.equal(headers.get('x-request-id'), 'req-contract-1');

const authControllerSource = fs.readFileSync(path.resolve('src/auth/auth.controller.ts'), 'utf8');
const twoFactorLoginSource = authControllerSource.slice(
  authControllerSource.indexOf('export const verifyLogin2FA'),
  authControllerSource.indexOf('export const changePassword'),
);
assert.match(twoFactorLoginSource, /sendApiError/);
assert.doesNotMatch(twoFactorLoginSource, /res\.status\((?:4|5)\d{2}\)\.json\(\{ message:/);

const passwordChangeSource = authControllerSource.slice(
  authControllerSource.indexOf('export const changePassword'),
  authControllerSource.indexOf('export const setup2FA'),
);
assert.match(passwordChangeSource, /sendApiError/);
assert.doesNotMatch(passwordChangeSource, /res\.status\((?:4|5)\d{2}\)\.json\(\{ message:/);

const twoFactorSettingsSource = authControllerSource.slice(
  authControllerSource.indexOf('export const setup2FA'),
  authControllerSource.indexOf('export const needsSetup'),
);
assert.match(twoFactorSettingsSource, /sendApiError/);
assert.doesNotMatch(twoFactorSettingsSource, /res\.status\((?:4|5)\d{2}\)\.json\(\{ message:/);

const passkeySource = authControllerSource.slice(
  authControllerSource.indexOf('export const generatePasskeyRegistrationOptionsHandler'),
  authControllerSource.indexOf('export const login'),
);
assert.match(passkeySource, /sendApiError/);
assert.match(passkeySource, /req\.body\?\.registrationResponse \?\? req\.body/);
assert.doesNotMatch(passkeySource, /res\.status\((?:4|5)\d{2}\)\.json\(\{[^\n]*message:/);
assert.doesNotMatch(passkeySource, /options\.challenge\.substring|CredentialID:/);

const setupAdminSource = authControllerSource.slice(
  authControllerSource.indexOf('export const setupAdmin'),
  authControllerSource.indexOf('export const logout'),
);
assert.match(setupAdminSource, /sendApiError/);
assert.doesNotMatch(setupAdminSource, /res\.status\((?:4|5)\d{2}\)\.json\(\{[^\n]*message:/);

const middlewareSourcePathList = [
  'src/auth/auth.middleware.ts',
  'src/auth/ipBlacklistCheck.middleware.ts',
  'src/auth/ipWhitelist.middleware.ts',
];
for (const middlewareSourcePath of middlewareSourcePathList) {
  const middlewareSource = fs.readFileSync(path.resolve(middlewareSourcePath), 'utf8');
  assert.match(middlewareSource, /sendApiError/);
  assert.doesNotMatch(middlewareSource, /res\.status\((?:4|5)\d{2}\)\.json\(\{[^\n]*message:/);
}

const appEntrySource = fs.readFileSync(path.resolve('src/index.ts'), 'utf8');
assert.match(appEntrySource, /app\.use\(normalizeLegacyApiErrorResponse\)/);

console.log('api error envelope behavior ok');

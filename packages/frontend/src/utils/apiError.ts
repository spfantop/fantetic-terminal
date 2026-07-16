import type { ApiErrorArgument, ApiErrorEnvelope } from '@fantetic-terminal/contracts';

type HttpErrorLike = {
  response?: {
    data?: unknown;
  };
};

const isApiErrorArgument = (value: unknown): value is ApiErrorArgument => (
  value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
);

export const readApiErrorEnvelope = (error: unknown): ApiErrorEnvelope | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const data = (error as HttpErrorLike).response?.data;
  if (!data || typeof data !== 'object') return undefined;

  const { code, args, requestId } = data as Partial<ApiErrorEnvelope>;
  if (
    typeof code !== 'string'
    || code.length === 0
    || !Array.isArray(args)
    || !args.every(isApiErrorArgument)
    || typeof requestId !== 'string'
    || requestId.length === 0
  ) return undefined;

  return { code, args, requestId };
};

const loginErrorKeyByCode: Record<string, string> = {
  'auth.usernamePasswordRequired': 'login.error.usernamePasswordRequired',
  'auth.captchaTokenRequired': 'login.error.captchaRequired',
  'auth.captchaRejected': 'login.error.captchaRejected',
  'auth.captchaVerificationUnavailable': 'login.error.captchaVerificationUnavailable',
  'auth.invalidCredentials': 'login.error.invalidCredentials',
  'auth.accountDisabled': 'login.error.accountDisabled',
  'auth.loginFailed': 'login.error.requestFailed',
  'auth.twoFactorChallengeInvalid': 'login.error.twoFactorChallengeInvalid',
  'auth.twoFactorTokenRequired': 'login.error.twoFactorTokenRequired',
  'auth.twoFactorTokenInvalid': 'login.error.twoFactorTokenInvalid',
  'auth.twoFactorVerificationFailed': 'login.error.twoFactorVerificationFailed',
  'auth.passkeyAuthenticationOptionsFailed': 'login.error.passkeyAuthOptionsFailed',
  'auth.passkeyAuthenticationResponseRequired': 'login.error.passkeyAuthFailed',
  'auth.passkeyAuthenticationChallengeMissing': 'login.error.passkeyAuthFailed',
  'auth.passkeyAuthenticationUserInvalid': 'login.error.passkeyAuthFailed',
  'auth.passkeyAuthenticationVerificationFailed': 'login.error.passkeyAuthFailed',
  'auth.passkeyAuthenticationFailed': 'login.error.passkeyAuthFailed',
};

export const resolveLoginErrorKey = (error: unknown): string => (
  loginErrorKeyByCode[readApiErrorEnvelope(error)?.code ?? ''] ?? 'login.error.requestFailed'
);

const passwordChangeErrorKeyByCode: Record<string, string> = {
  'auth.passwordChangeUnauthorized': 'settings.changePassword.error.unauthenticated',
  'auth.passwordChangeFieldsRequired': 'settings.changePassword.error.fieldsRequired',
  'auth.passwordChangeTooShort': 'settings.changePassword.error.tooShort',
  'auth.passwordChangeMustDiffer': 'settings.changePassword.error.mustDiffer',
  'auth.passwordChangeUserNotFound': 'settings.changePassword.error.userNotFound',
  'auth.passwordChangeCurrentPasswordInvalid': 'settings.changePassword.error.currentPasswordInvalid',
  'auth.passwordChangeFailed': 'settings.changePassword.error.generic',
};

export const resolvePasswordChangeErrorKey = (error: unknown): string => (
  passwordChangeErrorKeyByCode[readApiErrorEnvelope(error)?.code ?? '']
    ?? 'settings.changePassword.error.generic'
);

const twoFactorErrorKeyByCode: Record<string, string> = {
  'auth.twoFactorSetupUnauthorized': 'settings.twoFactor.error.unauthenticated',
  'auth.twoFactorAlreadyEnabled': 'settings.twoFactor.error.alreadyEnabled',
  'auth.twoFactorSetupFailed': 'settings.twoFactor.error.setupFailed',
  'auth.twoFactorActivationUnauthorized': 'settings.twoFactor.error.unauthenticated',
  'auth.twoFactorSetupMissing': 'settings.twoFactor.error.setupMissing',
  'auth.twoFactorTokenRequired': 'settings.twoFactor.error.codeRequired',
  'auth.twoFactorTokenInvalid': 'settings.twoFactor.error.verificationFailed',
  'auth.twoFactorActivationFailed': 'settings.twoFactor.error.activationFailed',
  'auth.twoFactorDisableUnauthorized': 'settings.twoFactor.error.unauthenticated',
  'auth.twoFactorDisablePasswordRequired': 'settings.twoFactor.error.passwordRequiredForDisable',
  'auth.twoFactorDisableUserNotFound': 'settings.twoFactor.error.userNotFound',
  'auth.twoFactorDisablePasswordInvalid': 'settings.twoFactor.error.currentPasswordInvalid',
  'auth.twoFactorDisableFailed': 'settings.twoFactor.error.disableFailed',
};

export const resolveTwoFactorErrorKey = (error: unknown): string => (
  twoFactorErrorKeyByCode[readApiErrorEnvelope(error)?.code ?? '']
    ?? 'settings.twoFactor.error.setupFailed'
);

const passkeyErrorKeyByCode: Record<string, string> = {
  'auth.passkeyRegistrationUnauthorized': 'settings.passkey.error.userNotLoggedIn',
  'auth.passkeyListUnauthorized': 'settings.passkey.error.userNotLoggedIn',
  'auth.passkeyDeleteUnauthorized': 'settings.passkey.error.userNotLoggedIn',
  'auth.passkeyNameUpdateUnauthorized': 'settings.passkey.error.userNotLoggedIn',
  'auth.passkeyCredentialIdRequired': 'settings.passkey.error.deleteFailedInvalidId',
  'auth.passkeyNameRequired': 'settings.passkey.error.nameRequired',
  'auth.passkeyNameUpdateForbidden': 'settings.passkey.error.nameUpdateFailed',
  'auth.passkeyNameUpdateFailed': 'settings.passkey.error.nameUpdateFailed',
  'auth.passkeyDeleteForbidden': 'settings.passkey.error.deleteFailedGeneral',
  'auth.passkeyDeleteFailed': 'settings.passkey.error.deleteFailedGeneral',
  'auth.passkeyNotFound': 'settings.passkey.error.deleteFailedGeneral',
  'auth.passkeyRegistrationOptionsFailed': 'settings.passkey.error.registrationFailed',
  'auth.passkeyRegistrationResponseRequired': 'settings.passkey.error.registrationFailed',
  'auth.passkeyRegistrationChallengeMissing': 'settings.passkey.error.registrationFailed',
  'auth.passkeyRegistrationContextMissing': 'settings.passkey.error.registrationFailed',
  'auth.passkeyRegistrationVerificationFailed': 'settings.passkey.error.registrationFailed',
  'auth.passkeyRegistrationFailed': 'settings.passkey.error.registrationFailed',
  'auth.passkeyListFailed': 'settings.passkey.error.registrationFailed',
};

export const resolvePasskeyErrorKey = (error: unknown): string => (
  passkeyErrorKeyByCode[readApiErrorEnvelope(error)?.code ?? '']
    ?? 'settings.passkey.error.registrationFailed'
);

const setupErrorKeyByCode: Record<string, string> = {
  'auth.setupFieldsRequired': 'setup.error.fieldsRequired',
  'auth.setupPasswordsDoNotMatch': 'setup.error.passwordsDoNotMatch',
  'auth.setupPasswordTooShort': 'setup.error.passwordTooShort',
  'auth.setupAlreadyCompleted': 'setup.error.alreadyCompleted',
  'auth.setupFailed': 'setup.error.generic',
};

export const resolveSetupErrorKey = (error: unknown): string => (
  setupErrorKeyByCode[readApiErrorEnvelope(error)?.code ?? '']
    ?? 'setup.error.generic'
);

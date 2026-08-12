import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
    authEpoch?: number;
    pendingTwoFactorUserId?: number;
    requiresTwoFactor?: boolean;
    rememberMe?: boolean;
    tempTwoFactorSecret?: string;
    tempTwoFactorSecretExpiresAt?: number;
    currentChallenge?: string;
    passkeyUserHandle?: string;
  }
}

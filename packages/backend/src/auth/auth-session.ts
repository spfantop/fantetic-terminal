import { Request } from 'express';

declare module 'express-session' {
  interface SessionData {
    pendingTwoFactorUserId?: number;
    authEpoch?: number;
  }
}

type AuthenticatedIdentity = {
  id: number;
  username: string;
  authEpoch: number;
};

type SessionRequest = Pick<Request, 'session'>;

const REMEMBER_ME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const regenerateSession = (req: SessionRequest): Promise<void> => new Promise((resolve, reject) => {
  req.session.regenerate((error) => {
    if (error) reject(error);
    else resolve();
  });
});

const saveSession = (req: SessionRequest): Promise<void> => new Promise((resolve, reject) => {
  req.session.save((error) => {
    if (error) reject(error);
    else resolve();
  });
});

export const completeLogin = async (
  req: SessionRequest,
  identity: AuthenticatedIdentity,
  { rememberMe }: { rememberMe: boolean },
): Promise<void> => {
  await regenerateSession(req);
  req.session.userId = identity.id;
  req.session.username = identity.username;
  req.session.authEpoch = identity.authEpoch;
  req.session.requiresTwoFactor = false;
  req.session.cookie.maxAge = rememberMe ? REMEMBER_ME_MAX_AGE_MS : undefined;
  await saveSession(req);
};

export const startTwoFactorChallenge = async (
  req: SessionRequest,
  { userId, rememberMe }: { userId: number; rememberMe: boolean },
): Promise<void> => {
  await regenerateSession(req);
  req.session.pendingTwoFactorUserId = userId;
  req.session.requiresTwoFactor = true;
  req.session.rememberMe = rememberMe;
  await saveSession(req);
};

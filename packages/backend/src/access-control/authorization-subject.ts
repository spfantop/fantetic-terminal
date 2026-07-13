import { SystemRole } from './access-policy';

export type AuthorizationSubject = {
  runtime: 'web' | 'desktop';
  userId: number;
  username: string;
  systemRole: SystemRole;
};

declare global {
  namespace Express {
    interface Request {
      authorization?: AuthorizationSubject;
    }
  }
}

type WebSubjectInput = {
  runtime: 'web';
  userId: number;
  username: string;
  systemRole: SystemRole;
  status: 'active' | 'disabled';
};

type DesktopSubjectInput = {
  runtime: 'desktop';
};

export const createAuthorizationSubject = (
  input: WebSubjectInput | DesktopSubjectInput,
): AuthorizationSubject | null => {
  if (input.runtime === 'desktop') {
    return {
      runtime: 'desktop',
      userId: 1,
      username: 'local-app',
      systemRole: 'super_admin',
    };
  }

  if (input.status !== 'active') return null;

  return {
    runtime: 'web',
    userId: input.userId,
    username: input.username,
    systemRole: input.systemRole,
  };
};

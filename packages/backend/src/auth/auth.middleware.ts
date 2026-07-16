import { Request, Response, NextFunction } from 'express';
import {
    ELECTRON_APP_USERNAME,
    ELECTRON_APP_USER_ID,
    isElectronAppMode,
} from '../config/app-mode';
import { createAuthorizationSubject } from '../access-control/authorization-subject';
import { userRepository } from '../user/user.repository';
import { setAuditActor } from '../audit/audit-context';
import { isElectronRuntimeNonceValid } from '../security/electron-runtime-nonce';
import { sendApiError } from '../security/api-error-envelope';

export const sessionMatchesAuthenticationEpoch = (
    sessionEpoch: number | undefined,
    userEpoch: number,
): boolean => sessionEpoch === userEpoch;

/**
 * 认证中间件：检查用户是否已登录 (通过 session 中的 userId 判断)
 */
export const isAuthenticated = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isElectronAppMode()) {
        if (!isElectronRuntimeNonceValid(req.headers)) {
            sendApiError(res, 401, 'auth.electronRuntimeUnauthorized');
            return;
        }
        req.session.userId = ELECTRON_APP_USER_ID;
        req.session.username = ELECTRON_APP_USERNAME;
        req.session.requiresTwoFactor = false;
        req.authorization = createAuthorizationSubject({ runtime: 'desktop' }) ?? undefined;
        if (req.authorization) setAuditActor(req.authorization);
        next();
        return;
    }

    if (req.session && req.session.userId) {
        try {
            const user = await userRepository.findUserById(req.session.userId);
            const authorization = user ? createAuthorizationSubject({
                runtime: 'web',
                userId: user.id,
                username: user.username,
                systemRole: user.system_role,
                status: user.status,
            }) : null;

            if (!authorization) {
                sendApiError(res, 401, 'auth.sessionUserInvalid');
                return;
            }

            if (!sessionMatchesAuthenticationEpoch(req.session.authEpoch, user!.auth_epoch)) {
                req.session.destroy(() => undefined);
                sendApiError(res, 401, 'auth.sessionExpired');
                return;
            }

            req.authorization = authorization;
            setAuditActor(authorization);
            next();
        } catch (error) {
            console.error('认证用户加载失败:', error);
            sendApiError(res, 500, 'auth.authenticationVerificationFailed');
        }
    } else {
        sendApiError(res, 401, 'auth.authenticationRequired');
    }
};


import { Request, Response, NextFunction } from 'express';
import {
    ELECTRON_APP_USERNAME,
    ELECTRON_APP_USER_ID,
    isElectronAppMode,
} from '../config/app-mode';
import { createAuthorizationSubject } from '../access-control/authorization-subject';
import { userRepository } from '../user/user.repository';
import { setAuditActor } from '../audit/audit-context';

export const sessionMatchesAuthenticationEpoch = (
    sessionEpoch: number | undefined,
    userEpoch: number,
): boolean => sessionEpoch === userEpoch;

/**
 * 认证中间件：检查用户是否已登录 (通过 session 中的 userId 判断)
 */
export const isAuthenticated = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isElectronAppMode()) {
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
                res.status(401).json({ message: '未授权：用户不存在或已被禁用。' });
                return;
            }

            if (!sessionMatchesAuthenticationEpoch(req.session.authEpoch, user!.auth_epoch)) {
                req.session.destroy(() => undefined);
                res.status(401).json({ message: '登录状态已失效，请重新登录。' });
                return;
            }

            req.authorization = authorization;
            setAuditActor(authorization);
            next();
        } catch (error) {
            console.error('认证用户加载失败:', error);
            res.status(500).json({ message: '服务器内部错误。' });
        }
    } else {
        // 用户未登录，返回 401 未授权错误
        res.status(401).json({ message: '未授权：请先登录。' });
    }
};


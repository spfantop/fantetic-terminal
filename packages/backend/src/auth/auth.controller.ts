import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { getDbInstance, runDb, getDb, allDb } from '../database/connection';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { NotificationService } from '../notifications/notification.service';
import { AuditLogService } from '../audit/audit.service';
import { runAuditProtectedOperation } from '../audit/audit-high-risk';
import { ipBlacklistService } from '../auth/ip-blacklist.service';
import { captchaService } from '../auth/captcha.service';
import { settingsService } from '../settings/settings.service';
import { passkeyService } from '../passkey/passkey.service'; // +++ Passkey Service
import { passkeyRepository } from '../passkey/passkey.repository'; // +++ Passkey Repository
import { userRepository } from '../user/user.repository'; // For passkey auth success
import {
    ELECTRON_APP_USERNAME,
    ELECTRON_APP_USER_ID,
    isElectronAppMode,
} from '../config/app-mode';
import { completeLogin, startTwoFactorChallenge } from './auth-session';
import { SystemRole } from '../access-control/access-policy';
import { createInitialAdministrator } from './initial-admin-bootstrap';
import { sendApiError } from '../security/api-error-envelope';
import { createLogger } from '../logging/logger';
import {
    clearPendingTwoFactorSetup,
    createPendingTwoFactorSetup,
    createTwoFactorQrCodeDataUrl,
    protectTwoFactorSecret,
    readPendingTwoFactorSecret,
    readTwoFactorSecret,
} from './two-factor-security';

const notificationService = new NotificationService();
const auditLogService = new AuditLogService();
const logger = createLogger('AuthController');

export interface User { 
    id: number;
    username: string;
    hashed_password: string; 
    two_factor_secret?: string | null;
    system_role: SystemRole;
    status: 'active' | 'disabled';
    auth_epoch: number;
}

const toPublicUser = (user: Pick<User, 'id' | 'username' | 'system_role'>) => ({
    id: user.id,
    username: user.username,
    systemRole: user.system_role,
});

declare module 'express-session' {
    interface SessionData {
        userId?: number;
        username?: string;
        tempTwoFactorSecret?: string;
        tempTwoFactorSecretExpiresAt?: number;
        requiresTwoFactor?: boolean;
        currentChallenge?: string; // +++ For Passkey challenge storage
        passkeyUserHandle?: string; // +++ For Passkey user handle (user ID as string)
        rememberMe?: boolean;
    }
}

// --- Passkey Controller Methods ---

/**
 * 生成 Passkey 注册选项 (POST /api/v1/auth/passkey/registration-options)
 */
export const generatePasskeyRegistrationOptionsHandler = async (req: Request, res: Response): Promise<void> => {
    const userId = req.session.userId;
    const username = req.session.username;

    if (!userId || !username) {
        sendApiError(res, 401, 'auth.passkeyRegistrationUnauthorized');
        return;
    }

    try {
        // PasskeyService's generateRegistrationOptions expects userId as number
        const options = await passkeyService.generateRegistrationOptions(username, userId);
        
        req.session.currentChallenge = options.challenge;
        // The user.id from options is a Uint8Array. We need to store the original string userId for userHandle.
        req.session.passkeyUserHandle = userId.toString(); 

        logger.info('Passkey registration options generated', { userId });
        res.json(options);
    } catch (error: unknown) {
        logger.error('Failed to generate Passkey registration options', { userId, error });
        sendApiError(res, 500, 'auth.passkeyRegistrationOptionsFailed');
    }
};

/**
 * 验证并保存新的 Passkey (POST /api/v1/auth/passkey/register)
 */
export const verifyPasskeyRegistrationHandler = async (req: Request, res: Response): Promise<void> => {
    const registrationResponse = req.body?.registrationResponse ?? req.body;
    const expectedChallenge = req.session.currentChallenge;
    const userHandle = req.session.passkeyUserHandle; 

    if (!registrationResponse) {
        sendApiError(res, 400, 'auth.passkeyRegistrationResponseRequired');
        return;
    }
    if (!expectedChallenge) {
        sendApiError(res, 400, 'auth.passkeyRegistrationChallengeMissing');
        return;
    }
    if (!userHandle) {
        sendApiError(res, 400, 'auth.passkeyRegistrationContextMissing');
        return;
    }

    try {
        const verification = await passkeyService.verifyRegistration(
            registrationResponse,
            expectedChallenge,
            userHandle // userHandle is userId as string
        );

        if (verification.verified && verification.newPasskeyToSave) {
            await passkeyRepository.createPasskey(verification.newPasskeyToSave);
            const userIdNum = parseInt(userHandle, 10);
            logger.info('Passkey registration verified and saved', { userId: userIdNum });
            auditLogService.logAction('PASSKEY_REGISTERED', { userId: userIdNum, credentialId: verification.newPasskeyToSave.credential_id });
            notificationService.sendNotification('PASSKEY_REGISTERED', { userId: userIdNum, username: req.session.username, credentialId: verification.newPasskeyToSave.credential_id });
            
            delete req.session.currentChallenge;
            delete req.session.passkeyUserHandle;
            res.status(201).json({ verified: true, message: 'Passkey 注册成功。' });
        } else {
            logger.warn('Passkey registration verification failed', { userId: userHandle });
            sendApiError(res, 400, 'auth.passkeyRegistrationVerificationFailed');
        }
    } catch (error: unknown) {
        logger.error('Failed to verify Passkey registration', { userId: userHandle, error });
        sendApiError(res, 500, 'auth.passkeyRegistrationFailed');
    }
};

/**
 * 生成 Passkey 认证选项 (POST /api/v1/auth/passkey/authentication-options)
 */
export const generatePasskeyAuthenticationOptionsHandler = async (req: Request, res: Response): Promise<void> => {
    const { username } = req.body; // Can be initiated by username (if not logged in) or for currently logged-in user

    try {
        // PasskeyService's generateAuthenticationOptions can optionally take a username
        const options = await passkeyService.generateAuthenticationOptions(username);
        
        req.session.currentChallenge = options.challenge;
        // For authentication, userHandle is not strictly needed in session beforehand if RP ID is specific enough
        // or if allowCredentials is used. We'll clear any old one just in case.
        delete req.session.passkeyUserHandle; 

        logger.info('Passkey authentication options generated', { hasUsername: Boolean(username) });
        res.json(options);
    } catch (error: unknown) {
        logger.error('Failed to generate Passkey authentication options', { hasUsername: Boolean(username), error });
        sendApiError(res, 500, 'auth.passkeyAuthenticationOptionsFailed');
    }
};

/**
 * 验证 Passkey 凭据并登录用户 (POST /api/v1/auth/passkey/authenticate)
 */
export const verifyPasskeyAuthenticationHandler = async (req: Request, res: Response): Promise<void> => {
    // Extract assertionResponse and rememberMe from the request body
    const { assertionResponse, rememberMe } = req.body;
    const expectedChallenge = req.session.currentChallenge;

    // Rename assertionResponse to authenticationResponseJSON for clarity within this scope
    const authenticationResponseJSON = assertionResponse;

    if (!authenticationResponseJSON) {
        sendApiError(res, 400, 'auth.passkeyAuthenticationResponseRequired');
        return;
    }
    if (!expectedChallenge) {
        sendApiError(res, 400, 'auth.passkeyAuthenticationChallengeMissing');
        return;
    }

    try {
        // Pass the extracted authenticationResponseJSON to the service
        const verification = await passkeyService.verifyAuthentication(
            authenticationResponseJSON,
            expectedChallenge
        );

        if (verification.verified && verification.userId && verification.passkey) {
            const user = await userRepository.findUserById(verification.userId);
            if (!user || user.status !== 'active') {
                // This should ideally not happen if passkey verification was successful
                logger.error('Passkey authentication verified but user is unavailable', { userId: verification.userId });
                auditLogService.logAction('PASSKEY_AUTH_FAILURE', { credentialId: verification.passkey.credential_id, reason: 'User not found after verification' });
                sendApiError(res, 401, 'auth.passkeyAuthenticationUserInvalid');
                return;
            }

            logger.info('Passkey authentication completed', { userId: user.id });
            
            const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
            auditLogService.logAction('PASSKEY_AUTH_SUCCESS', { userId: user.id, username: user.username, credentialId: verification.passkey.credential_id, ip: clientIp });
            notificationService.sendNotification('LOGIN_SUCCESS', { userId: user.id, username: user.username, ip: clientIp, method: 'Passkey' });

            await completeLogin(req, { id: user.id, username: user.username, authEpoch: user.auth_epoch }, { rememberMe: Boolean(rememberMe) });

            res.status(200).json({
                verified: true,
                message: 'Passkey 认证成功。',
                user: toPublicUser(user)
            });

        } else {
            logger.warn('Passkey authentication verification failed');
            const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
            auditLogService.logAction('PASSKEY_AUTH_FAILURE', {
                credentialId: authenticationResponseJSON?.id || 'unknown', // Use the extracted object
                reason: 'Verification failed',
                ip: clientIp
            });
            notificationService.sendNotification('PASSKEY_AUTH_FAILURE', { credentialId: authenticationResponseJSON?.id || 'unknown', reason: 'Verification failed', ip: clientIp });
            sendApiError(res, 401, 'auth.passkeyAuthenticationVerificationFailed');
        }
    } catch (error: unknown) {
        logger.error('Failed to verify Passkey authentication', { error });
        const errorMessage = error instanceof Error ? error.message : 'Unknown Passkey authentication error';
        const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
        auditLogService.logAction('PASSKEY_AUTH_FAILURE', {
            credentialId: authenticationResponseJSON?.id || 'unknown', // Use the extracted object
            reason: errorMessage,
            ip: clientIp
        });
        notificationService.sendNotification('PASSKEY_AUTH_FAILURE', { credentialId: authenticationResponseJSON?.id || 'unknown', reason: errorMessage, ip: clientIp });
        sendApiError(res, 500, 'auth.passkeyAuthenticationFailed');
    }
};


/**
 * 获取当前认证用户的所有 Passkey (GET /api/v1/user/passkeys)
 */
export const listUserPasskeysHandler = async (req: Request, res: Response): Promise<void> => {
    const userId = req.session.userId;
    const username = req.session.username;

    if (!userId || !username) {
        sendApiError(res, 401, 'auth.passkeyListUnauthorized');
        return;
    }

    try {
        const passkeys = await passkeyService.listPasskeysByUserId(userId);
        logger.info('Passkey list retrieved', { userId, passkeyCount: passkeys.length });
        res.status(200).json(passkeys);
    } catch (error: unknown) {
        logger.error('Failed to retrieve Passkey list', { userId, error });
        sendApiError(res, 500, 'auth.passkeyListFailed');
    }
};

/**
 * 删除当前认证用户指定的 Passkey (DELETE /api/v1/user/passkeys/:credentialID)
 */
export const deleteUserPasskeyHandler = async (req: Request, res: Response): Promise<void> => {
    const userId = req.session.userId;
    const username = req.session.username;
    const { credentialID } = req.params;

    if (!userId || !username) {
        sendApiError(res, 401, 'auth.passkeyDeleteUnauthorized');
        return;
    }

    if (!credentialID) {
        sendApiError(res, 400, 'auth.passkeyCredentialIdRequired');
        return;
    }

    try {
        const wasDeleted = await passkeyService.deletePasskey(userId, credentialID);
        if (wasDeleted) {
            logger.info('Passkey deleted', { userId });
            auditLogService.logAction('PASSKEY_DELETED', { userId, username, credentialId: credentialID });
            notificationService.sendNotification('PASSKEY_DELETED', { userId, username, credentialId: credentialID });
            res.status(200).json({ message: 'Passkey 删除成功。' });
        } else {
            // 这通常不应该发生，因为 service 层会在找不到或权限不足时抛出错误
            logger.warn('Passkey deletion returned no result', { userId });
            sendApiError(res, 404, 'auth.passkeyNotFound');
        }
    } catch (error: any) {
        logger.error('Failed to delete Passkey', { userId, error });
        if (error.message === 'Passkey not found.') {
            sendApiError(res, 404, 'auth.passkeyNotFound');
        } else if (error.message === 'Unauthorized to delete this passkey.') {
            auditLogService.logAction('PASSKEY_DELETE_UNAUTHORIZED', { userId, username, credentialIdAttempted: credentialID });
            sendApiError(res, 403, 'auth.passkeyDeleteForbidden');
        } else {
            sendApiError(res, 500, 'auth.passkeyDeleteFailed');
        }
    }
};

/**
 * 更新当前认证用户指定的 Passkey 名称 (PUT /api/v1/user/passkeys/:credentialID/name)
 */
export const updateUserPasskeyNameHandler = async (req: Request, res: Response): Promise<void> => {
    const userId = req.session.userId;
    const username = req.session.username;
    const { credentialID } = req.params;
    const { name } = req.body;

    if (!userId || !username) {
        sendApiError(res, 401, 'auth.passkeyNameUpdateUnauthorized');
        return;
    }

    if (!credentialID) {
        sendApiError(res, 400, 'auth.passkeyCredentialIdRequired');
        return;
    }

    if (typeof name !== 'string' || name.trim() === '') {
        sendApiError(res, 400, 'auth.passkeyNameRequired');
        return;
    }

    const trimmedName = name.trim();

    try {
        await passkeyService.updatePasskeyName(userId, credentialID, trimmedName);
        logger.info('Passkey name updated', { userId });
        auditLogService.logAction('PASSKEY_NAME_UPDATED', { userId, username, credentialId: credentialID, newName: trimmedName });
        // Optionally send a notification if desired
        // notificationService.sendNotification('PASSKEY_NAME_UPDATED', { userId, username, credentialId: credentialID, newName: trimmedName });
        res.status(200).json({ message: 'Passkey 名称更新成功。' });

    } catch (error: any) {
        logger.error('Failed to update Passkey name', { userId, error });
        if (error.message === 'Passkey not found.') {
            sendApiError(res, 404, 'auth.passkeyNotFound');
        } else if (error.message === 'Unauthorized to update this passkey name.') {
            auditLogService.logAction('PASSKEY_NAME_UPDATE_UNAUTHORIZED', { userId, username, credentialIdAttempted: credentialID });
            sendApiError(res, 403, 'auth.passkeyNameUpdateForbidden');
        } else {
            sendApiError(res, 500, 'auth.passkeyNameUpdateFailed');
        }
    }
};
 
 
/**
 * 处理用户登录请求 (POST /api/v1/auth/login)
 */
export const login = async (req: Request, res: Response): Promise<void> => {
    // 从请求体中解构 username, password 和可选的 rememberMe
    const { username, password, rememberMe } = req.body;

    if (!username || !password) {
        sendApiError(res, 400, 'auth.usernamePasswordRequired');
        return;
    }

    try {
        // --- CAPTCHA Verification Step ---
        const captchaConfig = await settingsService.getCaptchaConfig();
        if (captchaConfig.enabled) {
            const { captchaToken } = req.body;
            if (!captchaToken) {
                sendApiError(res, 400, 'auth.captchaTokenRequired');
                return; 
            }
            try {
                const isCaptchaValid = await captchaService.verifyToken(captchaToken);
                if (!isCaptchaValid) {
                    logger.warn('Login CAPTCHA verification failed');
                    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
                    ipBlacklistService.recordFailedAttempt(clientIp);
                    auditLogService.logAction('LOGIN_FAILURE', { username, reason: 'Invalid CAPTCHA token', ip: clientIp });
                    notificationService.sendNotification('LOGIN_FAILURE', { username, reason: 'Invalid CAPTCHA token', ip: clientIp }); 
                    sendApiError(res, 401, 'auth.captchaRejected');
                    return;
                }
                logger.info('Login CAPTCHA verification succeeded');
            } catch (error) {
                logger.error('Login CAPTCHA verification failed unexpectedly', { error });
                sendApiError(res, 500, 'auth.captchaVerificationUnavailable');
                return;
            }
        } else {
            logger.debug('Login CAPTCHA verification skipped because it is disabled');
        }


        const db = await getDbInstance(); 
        const user = await getDb<User>(db, 'SELECT id, username, hashed_password, two_factor_secret, system_role, status, auth_epoch FROM users WHERE username = ?', [username]);

     

        if (!user) {
            logger.warn('Login failed because the user was not found');
            const clientIp = req.ip || req.socket?.remoteAddress || 'unknown'; 
            ipBlacklistService.recordFailedAttempt(clientIp);
            auditLogService.logAction('LOGIN_FAILURE', { username, reason: 'User not found', ip: clientIp });
            notificationService.sendNotification('LOGIN_FAILURE', { username, reason: 'User not found', ip: clientIp }); 
            sendApiError(res, 401, 'auth.invalidCredentials');
            return;
        }

        if (user.status !== 'active') {
            sendApiError(res, 403, 'auth.accountDisabled');
            return;
        }

        const isMatch = await bcrypt.compare(password, user.hashed_password);

        if (!isMatch) {
            logger.warn('Login failed because the password was invalid');
            const clientIp = req.ip || req.socket?.remoteAddress || 'unknown'; 
            ipBlacklistService.recordFailedAttempt(clientIp);
            auditLogService.logAction('LOGIN_FAILURE', { username, reason: 'Invalid password', ip: clientIp });
            notificationService.sendNotification('LOGIN_FAILURE', { username, reason: 'Invalid password', ip: clientIp }); 
            sendApiError(res, 401, 'auth.invalidCredentials');
            return;
        }

        // 检查是否启用了 2FA
        if (user.two_factor_secret) {
            logger.info('Login requires a two-factor challenge', { userId: user.id });
            await startTwoFactorChallenge(req, {
                userId: user.id,
                rememberMe: Boolean(rememberMe),
            });
            res.status(200).json({ message: '需要进行两步验证。', requiresTwoFactor: true });
        } else {
            logger.info('Login completed without a two-factor challenge', { userId: user.id });
            const clientIp = req.ip || req.socket?.remoteAddress || 'unknown'; 
            ipBlacklistService.resetAttempts(clientIp);
            auditLogService.logAction('LOGIN_SUCCESS', { userId: user.id, username, ip: clientIp });
            notificationService.sendNotification('LOGIN_SUCCESS', { userId: user.id, username, ip: clientIp }); 
            await completeLogin(req, { id: user.id, username: user.username, authEpoch: user.auth_epoch }, { rememberMe: Boolean(rememberMe) });

            res.status(200).json({
                message: '登录成功。',
                user: toPublicUser(user)
            });
        }

    } catch (error) {
        logger.error('Login failed unexpectedly', { error });
        sendApiError(res, 500, 'auth.loginFailed');
    }
};

/**
 * 获取当前用户的认证状态 (GET /api/v1/auth/status)
 */
export const getAuthStatus = async (req: Request, res: Response): Promise<void> => {
    if (isElectronAppMode()) {
        req.session.userId = ELECTRON_APP_USER_ID;
        req.session.username = ELECTRON_APP_USERNAME;
        req.session.requiresTwoFactor = false;
        res.status(200).json({
            isAuthenticated: true,
            user: {
                id: ELECTRON_APP_USER_ID,
                username: ELECTRON_APP_USERNAME,
                systemRole: 'super_admin',
                isTwoFactorEnabled: false
            }
        });
        return;
    }

    const userId = req.session.userId;
    const username = req.session.username;

    if (!userId || !username || req.session.requiresTwoFactor) {
        res.status(401).json({ isAuthenticated: false });
        return;
    }

    try {
        const db = await getDbInstance(); 
        const user = await getDb<{ two_factor_secret: string | null; system_role: SystemRole }>(db, 'SELECT two_factor_secret, system_role FROM users WHERE id = ?', [userId]);

        if (!user) {
             res.status(401).json({ isAuthenticated: false });
             return;
        }

        res.status(200).json({
            isAuthenticated: true,
            user: {
                id: userId,
                username: username,
                systemRole: user.system_role,
                isTwoFactorEnabled: !!user.two_factor_secret 
            }
        });

    } catch (error) {
        logger.error('Failed to retrieve authentication status', { userId, error });
        res.status(500).json({ message: '获取认证状态时发生内部服务器错误。' });
    }
};
/**
 * 处理登录时的 2FA 验证 (POST /api/v1/auth/login/2fa)
 */
export const verifyLogin2FA = async (req: Request, res: Response): Promise<void> => {
    const { token } = req.body;
    const userId = req.session.pendingTwoFactorUserId;

    if (!userId || !req.session.requiresTwoFactor) {
        sendApiError(res, 400, 'auth.twoFactorChallengeInvalid');
        return;
    }

    if (!token) {
        sendApiError(res, 400, 'auth.twoFactorTokenRequired');
        return;
    }

    try {
        const db = await getDbInstance();
        const user = await getDb<User>(db, 'SELECT id, username, two_factor_secret, system_role, status, auth_epoch FROM users WHERE id = ?', [userId]);

    

        if (!user || user.status !== 'active' || !user.two_factor_secret) {
            logger.error('Two-factor challenge context is invalid', { userId });
            sendApiError(res, 400, 'auth.twoFactorChallengeInvalid');
            return;
        }

        const twoFactorSecret = await readTwoFactorSecret(db, user.id, user.two_factor_secret);
        const verified = speakeasy.totp.verify({
            secret: twoFactorSecret,
            encoding: 'base32',
            token: token,
            window: 1 
        });

        if (verified) {
            logger.info('Two-factor challenge verified', { userId: user.id });
            const clientIp = req.ip || req.socket?.remoteAddress || 'unknown'; 
            ipBlacklistService.resetAttempts(clientIp);
            auditLogService.logAction('LOGIN_SUCCESS', { userId: user.id, username: user.username, ip: clientIp, twoFactor: true });
            notificationService.sendNotification('LOGIN_SUCCESS', { userId: user.id, username: user.username, ip: clientIp, twoFactor: true }); 
            const rememberMe = Boolean(req.session.rememberMe);
            await completeLogin(req, { id: user.id, username: user.username, authEpoch: user.auth_epoch }, { rememberMe });

            res.status(200).json({
                message: '登录成功。',
                user: toPublicUser(user)
            });
        } else {
            logger.warn('Two-factor challenge verification failed', { userId: user.id });
            const clientIp = req.ip || req.socket?.remoteAddress || 'unknown'; 
            ipBlacklistService.recordFailedAttempt(clientIp);
            auditLogService.logAction('LOGIN_FAILURE', { userId: user.id, username: user.username, reason: 'Invalid 2FA token', ip: clientIp });
            notificationService.sendNotification('LOGIN_FAILURE', { userId: user.id, username: user.username, reason: 'Invalid 2FA token', ip: clientIp }); 
            sendApiError(res, 401, 'auth.twoFactorTokenInvalid');
        }

    } catch (error) {
        logger.error('Two-factor challenge verification failed unexpectedly', { userId, error });
        sendApiError(res, 500, 'auth.twoFactorVerificationFailed');
    }
};


/**
 * 处理修改密码请求 (PUT /api/v1/auth/password)
 */
export const changePassword = async (req: Request, res: Response): Promise<void> => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session.userId; 

    if (!userId || req.session.requiresTwoFactor) {
        sendApiError(res, 401, 'auth.passwordChangeUnauthorized');
        return;
    }

    if (!currentPassword || !newPassword) {
        sendApiError(res, 400, 'auth.passwordChangeFieldsRequired');
        return;
    }
    if (newPassword.length < 8) {
        sendApiError(res, 400, 'auth.passwordChangeTooShort');
        return;
    }
    if (currentPassword === newPassword) {
        sendApiError(res, 400, 'auth.passwordChangeMustDiffer');
        return;
    }

    try {
        const db = await getDbInstance(); 
        const user = await getDb<User>(db, 'SELECT id, hashed_password FROM users WHERE id = ?', [userId]);



        if (!user) {
            logger.error('Password change target user was not found', { userId });
            sendApiError(res, 404, 'auth.passwordChangeUserNotFound');
            return;
        }

        const isMatch = await bcrypt.compare(currentPassword, user.hashed_password);
        if (!isMatch) {
            logger.warn('Password change rejected because the current password is invalid', { userId });
            sendApiError(res, 400, 'auth.passwordChangeCurrentPasswordInvalid');
            return;
        }

        const saltRounds = 10;
        const newHashedPassword = await bcrypt.hash(newPassword, saltRounds);
        const now = Math.floor(Date.now() / 1000);


        const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
        const result = await runAuditProtectedOperation(auditLogService, 'PASSWORD_CHANGED', {
            userId, ip: clientIp, phase: 'requested',
        }, () => runDb(db,
            'UPDATE users SET hashed_password = ?, auth_epoch = auth_epoch + 1, updated_at = ? WHERE id = ?',
            [newHashedPassword, now, userId]
        ));

        if (result.changes === 0) {
            logger.error('Password change update did not affect a user row', { userId });
            throw new Error('未找到要更新的用户'); 
        }

        logger.info('Password changed', { userId });
        auditLogService.logAction('PASSWORD_CHANGED', { userId, ip: clientIp, phase: 'completed' });
        notificationService.sendNotification('PASSWORD_CHANGED', { userId, ip: clientIp }); 

        res.status(200).json({ message: '密码已成功修改。' });

    } catch (error) {
        logger.error('Password change failed unexpectedly', { userId, error });
        sendApiError(res, 500, 'auth.passwordChangeFailed');
    }
};

/**
 * 开始 2FA 设置流程 (POST /api/v1/auth/2fa/setup)
 * 生成临时密钥和二维码
 */
export const setup2FA = async (req: Request, res: Response): Promise<void> => {
    const userId = req.session.userId;
    const username = req.session.username; 

    if (!userId || !username || req.session.requiresTwoFactor) {
        sendApiError(res, 401, 'auth.twoFactorSetupUnauthorized');
        return;
    }

    try {
        const db = await getDbInstance();
        const user = await getDb<{ two_factor_secret: string | null }>(db, 'SELECT two_factor_secret FROM users WHERE id = ?', [userId]);
        const existingSecret = user ? user.two_factor_secret : null;


        if (existingSecret) {
            sendApiError(res, 400, 'auth.twoFactorAlreadyEnabled');
            return;
        }

        const secret = speakeasy.generateSecret({
            length: 20,
            name: `FanteticTerminal (${username})`
        });

        if (!secret.otpauth_url) {
            throw new Error('无法生成 OTP Auth URL');
        }

        createPendingTwoFactorSetup(req.session, secret.base32);
        const qrCodeUrl = await createTwoFactorQrCodeDataUrl(secret.otpauth_url, (value, callback) => {
            qrcode.toDataURL(value, callback);
        });
        res.json({
            secret: secret.base32,
            qrCodeUrl,
        });

    } catch (error: any) {
        clearPendingTwoFactorSetup(req.session);
        logger.error('Two-factor setup failed', { userId, error });
        sendApiError(res, 500, 'auth.twoFactorSetupFailed');
    }
};




/**
 * 验证并激活 2FA (POST /api/v1/auth/2fa/verify)
 */
export const verifyAndActivate2FA = async (req: Request, res: Response): Promise<void> => {
    const { token } = req.body;
    const userId = req.session.userId;
    const tempSecret = readPendingTwoFactorSecret(req.session);

    if (!userId || req.session.requiresTwoFactor) {
        sendApiError(res, 401, 'auth.twoFactorActivationUnauthorized');
        return;
    }

    if (!tempSecret) {
        sendApiError(res, 400, 'auth.twoFactorSetupMissing');
        return;
    }

    if (!token) {
        sendApiError(res, 400, 'auth.twoFactorTokenRequired');
        return;
    }

    try {
        const db = await getDbInstance();
        const verified = speakeasy.totp.verify({
            secret: tempSecret,
            encoding: 'base32',
            token: token,
            window: 1 
        });

        if (verified) {
            const now = Math.floor(Date.now() / 1000);
            const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
            const result = await runAuditProtectedOperation(auditLogService, '2FA_ENABLED', {
                userId, ip: clientIp, phase: 'requested',
            }, () => runDb(db,
                'UPDATE users SET two_factor_secret = ?, updated_at = ? WHERE id = ?',
                [protectTwoFactorSecret(tempSecret), now, userId]
            ));

            if (result.changes === 0) {
                logger.error('Two-factor activation update did not affect a user row', { userId });
                throw new Error('未找到要更新的用户');
            }

            logger.info('Two-factor authentication enabled', { userId });
            auditLogService.logAction('2FA_ENABLED', { userId, ip: clientIp, phase: 'completed' });
            notificationService.sendNotification('2FA_ENABLED', { userId, ip: clientIp }); 

            clearPendingTwoFactorSetup(req.session);

            res.status(200).json({ message: '两步验证已成功激活！' });
        } else {
            logger.warn('Two-factor activation verification failed', { userId });
            sendApiError(res, 400, 'auth.twoFactorTokenInvalid');
        }

    } catch (error: any) {
        logger.error('Two-factor activation failed unexpectedly', { userId, error });
        sendApiError(res, 500, 'auth.twoFactorActivationFailed');
    }
};

export const cancel2FASetup = (req: Request, res: Response): void => {
    clearPendingTwoFactorSetup(req.session);
    res.status(204).end();
};

/**
 * 禁用 2FA (DELETE /api/v1/auth/2fa)
 */
export const disable2FA = async (req: Request, res: Response): Promise<void> => {
    const userId = req.session.userId;
    const { password } = req.body; 

    if (!userId || req.session.requiresTwoFactor) {
        sendApiError(res, 401, 'auth.twoFactorDisableUnauthorized');
        return;
    }

    if (!password) {
        sendApiError(res, 400, 'auth.twoFactorDisablePasswordRequired');
        return;
    }

    try {
        const db = await getDbInstance(); 
        const user = await getDb<User>(db, 'SELECT id, hashed_password FROM users WHERE id = ?', [userId]);

        if (!user) {
            sendApiError(res, 404, 'auth.twoFactorDisableUserNotFound'); return;
        }
        const isMatch = await bcrypt.compare(password, user.hashed_password);
        if (!isMatch) {
            sendApiError(res, 400, 'auth.twoFactorDisablePasswordInvalid'); return;
        }

        const now = Math.floor(Date.now() / 1000);
        const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
        const result = await runAuditProtectedOperation(auditLogService, '2FA_DISABLED', {
            userId, ip: clientIp, phase: 'requested',
        }, () => runDb(db,
            'UPDATE users SET two_factor_secret = NULL, updated_at = ? WHERE id = ?',
            [now, userId]
        ));

        if (result.changes === 0) {
            logger.error('Two-factor disable update did not affect a user row', { userId });
            throw new Error('未找到要更新的用户');
        }

        logger.info('Two-factor authentication disabled', { userId });
        auditLogService.logAction('2FA_DISABLED', { userId, ip: clientIp, phase: 'completed' });
        notificationService.sendNotification('2FA_DISABLED', { userId, ip: clientIp }); 
        clearPendingTwoFactorSetup(req.session);

        res.status(200).json({ message: '两步验证已成功禁用。' });

    } catch (error: any) {
        logger.error('Two-factor disable failed unexpectedly', { userId, error });
        sendApiError(res, 500, 'auth.twoFactorDisableFailed');
    }
};

/**
 * 检查是否需要进行初始设置 (GET /api/v1/auth/needs-setup)
 * 如果数据库中没有用户，则需要设置。
 */
export const needsSetup = async (req: Request, res: Response): Promise<void> => {
    if (isElectronAppMode()) {
        res.status(200).json({ needsSetup: false });
        return;
    }

    try {
        const db = await getDbInstance(); 
        const row = await getDb<{ count: number }>(db, 'SELECT COUNT(*) as count FROM users');
        const userCount = row ? row.count : 0;

        res.status(200).json({ needsSetup: userCount === 0 });

    } catch (error) {
        logger.error('Failed to check initial setup status', { error });
        res.status(500).json({ message: '检查设置状态时发生错误。', needsSetup: false });
    }
};

/**
 * 处理初始管理员账号设置请求 (POST /api/v1/auth/setup)
 */
export const setupAdmin = async (req: Request, res: Response): Promise<void> => {
    const { username, password, confirmPassword } = req.body;

    if (!username || !password || !confirmPassword) {
        sendApiError(res, 400, 'auth.setupFieldsRequired');
        return;
    }
    if (password !== confirmPassword) {
        sendApiError(res, 400, 'auth.setupPasswordsDoNotMatch');
        return;
    }
     if (password.length < 8) {
        sendApiError(res, 400, 'auth.setupPasswordTooShort');
        return;
    }


    try {
        const db = await getDbInstance();
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const now = Math.floor(Date.now() / 1000);
        const result = await createInitialAdministrator(db, { username, hashedPassword, now });

        if (!result.created) {
            logger.warn('Initial setup was attempted after an administrator already exists');
            sendApiError(res, 403, 'auth.setupAlreadyCompleted');
            return;
        }
        if (typeof result.userId !== 'number' || result.userId <= 0) {
             logger.error('Initial administrator creation did not return a valid user ID');
             throw new Error('创建初始管理员失败，可能用户名已存在。');
        }
        const newUser = { id: result.userId };


        logger.info('Initial administrator created', { userId: newUser.id });
        const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
        auditLogService.logAction('ADMIN_SETUP_COMPLETE', { userId: newUser.id, username, ip: clientIp });
        notificationService.sendNotification('ADMIN_SETUP_COMPLETE', { userId: newUser.id, username, ip: clientIp }); 

        res.status(201).json({ message: '初始管理员账号创建成功！' });

    } catch (error: any) {
        logger.error('Initial setup failed unexpectedly', { error });
        sendApiError(res, 500, 'auth.setupFailed');
    }
};

/**
 * 处理用户登出请求 (POST /api/v1/auth/logout)
 */
export const logout = (req: Request, res: Response): void => {
    const userId = req.session.userId;
    const username = req.session.username;

    req.session.destroy((err) => {
        if (err) {
            logger.error('Failed to destroy an authenticated session during logout', { userId, error: err });
            res.status(500).json({ message: '登出时发生服务器内部错误。' });
        } else {
            logger.info('User logged out', { userId });
            res.clearCookie('connect.sid'); 
            if (userId) { 
                 const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
                 auditLogService.logAction('LOGOUT', { userId, username, ip: clientIp });
                 notificationService.sendNotification('LOGOUT', { userId, username, ip: clientIp }); 
            }
            res.status(200).json({ message: '已成功登出。' });
        }
    });
};

/**
 * 获取公共 CAPTCHA 配置 (GET /api/v1/auth/captcha/config)
 * 返回给前端用于显示 CAPTCHA 小部件所需的信息 (不含密钥)。
 */
export const getPublicCaptchaConfig = async (req: Request, res: Response): Promise<void> => {
    try {
        logger.debug('Public CAPTCHA configuration requested');
        const fullConfig = await settingsService.getCaptchaConfig();

        const publicConfig = {
            enabled: fullConfig.enabled,
            provider: fullConfig.provider,
            hcaptchaSiteKey: fullConfig.hcaptchaSiteKey,
            recaptchaSiteKey: fullConfig.recaptchaSiteKey,
        };

        logger.debug('Public CAPTCHA configuration returned', { enabled: publicConfig.enabled, provider: publicConfig.provider });
        res.status(200).json(publicConfig);
    } catch (error: any) {
        logger.error('Failed to retrieve public CAPTCHA configuration', { error });
        res.status(500).json({
             enabled: false,
             provider: 'none',
             hcaptchaSiteKey: '',
             recaptchaSiteKey: '',
             error: '获取 CAPTCHA 配置失败'
        });
    }
};

/**
 * 检查系统中是否配置了任何 Passkey (GET /api/v1/auth/passkey/has-configured)
 * 或者特定用户是否配置了 Passkey (GET /api/v1/auth/passkey/has-configured?username=xxx)
 * 公开访问，用于登录页面判断是否显示 Passkey 登录按钮。
 */
export const checkHasPasskeys = async (req: Request, res: Response): Promise<void> => {
    const username = req.query.username as string | undefined;
    try {
        const hasPasskeys = await passkeyService.hasPasskeysConfigured(username);
        res.status(200).json({ hasPasskeys });
    } catch (error: any) {
        logger.error('Failed to check Passkey configuration status', { error });
        // 即使出错，也返回 false，避免登录流程中断
        res.status(200).json({ hasPasskeys: false, error: '检查 Passkey 配置时出错。' });
    }
};

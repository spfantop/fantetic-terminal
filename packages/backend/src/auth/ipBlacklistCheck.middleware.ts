import { Request, Response, NextFunction } from 'express';
import { ipBlacklistService } from '../auth/ip-blacklist.service';
import { settingsService } from '../settings/settings.service'; 
import { sendApiError } from '../security/api-error-envelope';

/**
 * IP 黑名单检查中间件
 * 在处理登录相关请求前，检查来源 IP 是否在黑名单中且处于封禁期。
 */
export const ipBlacklistCheckMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    // 获取客户端 IP (与 auth.controller 一致)
    const clientIp = req.ip || req.socket?.remoteAddress;

    if (!clientIp) {
        // 如果无法获取 IP，为安全起见，阻止请求
        console.warn('[IP Blacklist Check] 无法获取请求 IP 地址，已拒绝访问。');
        sendApiError(res, 403, 'auth.sourceIpUnavailable');
        return; // 显式返回 void
    }

    try {
        // 首先检查 IP 黑名单功能是否启用
        const isEnabled = await settingsService.isIpBlacklistEnabled();
        if (!isEnabled) {
            // console.log('[IP Blacklist Check] 功能已禁用，跳过检查。');
            return next(); // 功能禁用，直接放行
        }

        const isBlocked = await ipBlacklistService.isBlocked(clientIp);
        if (isBlocked) {
            console.warn(`[IP Blacklist Check] 已阻止来自被封禁 IP ${clientIp} 的访问。`);
            sendApiError(res, 403, 'auth.sourceIpBlocked');
            return; // 显式返回 void
        }
        // IP 未被封禁，继续处理请求
        next();
    } catch (error) {
        console.error(`[IP Blacklist Check] 检查 IP ${clientIp} 时发生错误:`, error);
        sendApiError(res, 500, 'auth.ipBlacklistVerificationFailed');
        return; // 显式返回 void
    }
};

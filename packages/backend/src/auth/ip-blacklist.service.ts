
import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import { settingsService } from '../settings/settings.service';
import { NotificationService } from '../notifications/notification.service'; 
import { createLogger } from '../logging/logger';


const notificationService = new NotificationService(); // 实例化 NotificationService
const logger = createLogger('IpBlacklistService');

// 黑名单相关设置的 Key
const MAX_LOGIN_ATTEMPTS_KEY = 'maxLoginAttempts';
const LOGIN_BAN_DURATION_KEY = 'loginBanDuration'; // 单位：秒

// 与 ipWhitelist.middleware.ts 保持一致
const LOCAL_IPS = [
    '127.0.0.1',    // IPv4 本地回环
    '::1',          // IPv6 本地回环
    'localhost'     // 本地主机名 (虽然通常解析为上面两者，但也包含以防万一)
];

// 黑名单条目接口
interface IpBlacklistEntry {
    ip: string;
    attempts: number;
    last_attempt_at: number;
    blocked_until: number | null;
}


type DbIpBlacklistRow = IpBlacklistEntry;

export class IpBlacklistService {

    /**
     * 获取指定 IP 的黑名单记录
     * @param ip IP 地址
     * @returns 黑名单记录或 undefined
     */
    private async getEntry(ip: string): Promise<IpBlacklistEntry | undefined> {
        try {
            const db = await getDbInstance();
            const row = await getDbRow<DbIpBlacklistRow>(db, 'SELECT * FROM ip_blacklist WHERE ip = ?', [ip]);
            return row; // Returns undefined if not found
        } catch (error) {
            logger.error('Failed to query IP blacklist entry', { errorName: error instanceof Error ? error.name : 'UnknownError' });
            throw new Error('数据库查询失败'); // Re-throw error
        }
    }

    /**
     * 检查 IP 是否当前被封禁
     * @param ip IP 地址
     * @returns 如果被封禁则返回 true，否则返回 false
     */
     async isBlocked(ip: string): Promise<boolean> {
         // 首先检查功能是否启用
         if (!(await settingsService.isIpBlacklistEnabled())) {
             return false; // 如果禁用，则认为 IP 未被阻止
         }
 
         try {
             const entry = await this.getEntry(ip);
             if (!entry) {
                return false; // 不在黑名单中
            }
            // 检查封禁时间是否已过
            if (entry.blocked_until && entry.blocked_until > Math.floor(Date.now() / 1000)) {
                logger.info('IP blacklist entry is currently blocked');
                return true; // 仍在封禁期内
            }
            return false;
        } catch (error) {
            logger.error('Failed to check IP blacklist status', { errorName: error instanceof Error ? error.name : 'UnknownError' });
            return false; // 出错时默认不封禁
        }
    }

    /**
     * 记录一次登录失败尝试
     * 如果达到阈值，则封禁该 IP
     * @param ip IP 地址
     */
    async recordFailedAttempt(ip: string): Promise<void> {
        // 首先检查功能是否启用
        if (!(await settingsService.isIpBlacklistEnabled())) {
            return; // 如果禁用，则不记录失败尝试
        }

        if (LOCAL_IPS.includes(ip)) {
            logger.debug('Skipping IP blacklist update for a local address');
            return;
        }

        const now = Math.floor(Date.now() / 1000);
        try {
            const db = await getDbInstance();
            const maxAttemptsStr = await settingsService.getSetting(MAX_LOGIN_ATTEMPTS_KEY);
            const banDurationStr = await settingsService.getSetting(LOGIN_BAN_DURATION_KEY);

            const maxAttempts = parseInt(maxAttemptsStr || '5', 10) || 5;
            const banDuration = parseInt(banDurationStr || '300', 10) || 300;

            const entry = await this.getEntry(ip);

            if (entry) {
                const newAttempts = entry.attempts + 1;
                let blockedUntil = entry.blocked_until;
                let shouldNotify = false;

                if (newAttempts >= maxAttempts && !entry.blocked_until) { 
                    blockedUntil = now + banDuration;
                    shouldNotify = true;
                    logger.warn('IP blacklist threshold reached; address blocked', { attempts: newAttempts, maxAttempts, banDurationSeconds: banDuration });
                } else if (newAttempts >= maxAttempts && entry.blocked_until) {
                    logger.info('Blocked IP recorded another failed login attempt', { attempts: newAttempts, maxAttempts });
                }

                await runDb(db,
                    'UPDATE ip_blacklist SET attempts = ?, last_attempt_at = ?, blocked_until = ? WHERE ip = ?',
                    [newAttempts, now, blockedUntil, ip]
                );

                if (shouldNotify && blockedUntil) {
                    notificationService.sendNotification('IP_BLOCKED', {
                        ip: ip,
                        attempts: newAttempts,
                        duration: banDuration,
                        blockedUntil: new Date(blockedUntil * 1000).toISOString()
                    }).catch(error => logger.error('Failed to send IP blacklist notification', { errorName: error instanceof Error ? error.name : 'UnknownError' }));
                }

            } else {
                // Insert new record
                let blockedUntil: number | null = null;
                const attempts = 1;
                let shouldNotify = false;

                if (attempts >= maxAttempts) {
                    blockedUntil = now + banDuration;
                    shouldNotify = true;
                    logger.warn('IP blacklist initial attempt reached threshold; address blocked', { attempts, maxAttempts, banDurationSeconds: banDuration });
                }

                await runDb(db,
                    'INSERT INTO ip_blacklist (ip, attempts, last_attempt_at, blocked_until) VALUES (?, ?, ?, ?)',
                    [ip, attempts, now, blockedUntil]
                );

                 if (shouldNotify && blockedUntil) {
                     notificationService.sendNotification('IP_BLOCKED', {
                         ip: ip,
                         attempts: attempts,
                         duration: banDuration,
                         blockedUntil: new Date(blockedUntil * 1000).toISOString()
                     }).catch(error => logger.error('Failed to send IP blacklist notification', { errorName: error instanceof Error ? error.name : 'UnknownError' }));
                 }
            }
        } catch (error) {
            logger.error('Failed to record IP blacklist login attempt', { errorName: error instanceof Error ? error.name : 'UnknownError' });
        }
    }

    /**
     * 重置指定 IP 的失败尝试次数和封禁状态 (例如登录成功后调用)
     * @param ip IP 地址
     */
    async resetAttempts(ip: string): Promise<void> {
        try {
            const db = await getDbInstance();
            await runDb(db, 'DELETE FROM ip_blacklist WHERE ip = ?', [ip]);
            logger.info('IP blacklist attempts reset');
        } catch (error) {
            logger.error('Failed to reset IP blacklist attempts', { errorName: error instanceof Error ? error.name : 'UnknownError' });
        }
    }

    /**
     * 获取所有黑名单记录 (用于管理界面)
     * @param limit 每页数量
     * @param offset 偏移量
     */
    async getBlacklist(limit: number = 50, offset: number = 0): Promise<{ entries: IpBlacklistEntry[], total: number }> {
        try {
            const db = await getDbInstance();
            const entries = await allDb<DbIpBlacklistRow>(db,
                'SELECT * FROM ip_blacklist ORDER BY last_attempt_at DESC LIMIT ? OFFSET ?',
                [limit, offset]
            );
            const countRow = await getDbRow<{ count: number }>(db, 'SELECT COUNT(*) as count FROM ip_blacklist');
            const total = countRow?.count ?? 0;
            return { entries, total };
        } catch (error) {
             logger.error('Failed to retrieve IP blacklist', { errorName: error instanceof Error ? error.name : 'UnknownError' });
             return { entries: [], total: 0 };
        }
    }

    /**
     * 从黑名单中删除一个 IP (解除封禁)
     * @param ip IP 地址
     * @returns Promise<boolean> 是否成功删除
     */
    async removeFromBlacklist(ip: string): Promise<boolean> {
        try {
            const db = await getDbInstance();
            const result = await runDb(db, 'DELETE FROM ip_blacklist WHERE ip = ?', [ip]);
            if (result.changes > 0) {
                logger.info('IP blacklist entry removed');
                return true;
            } else {
                logger.warn('Attempted to remove an IP blacklist entry that does not exist');
                return false;
            }
        } catch (error) {
            logger.error('Failed to remove IP blacklist entry', { errorName: error instanceof Error ? error.name : 'UnknownError' });
            throw new Error(`从黑名单删除 IP ${ip} 时出错`);
        }
    }
}

// 导出单例
export const ipBlacklistService = new IpBlacklistService();

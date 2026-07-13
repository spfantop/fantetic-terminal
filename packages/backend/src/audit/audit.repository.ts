import { Database } from 'sqlite3';
import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import { AuditLogEntry, AuditLogActionType } from '../types/audit.types';
import type { AuditContext } from './audit-context';


type DbAuditLogRow = AuditLogEntry;
let lastAuditCleanupAt = 0;
const AUDIT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const readMaxAuditEntries = (): number => {
    const value = Number(process.env.AUDIT_MAX_ENTRIES ?? 50000);
    return Number.isInteger(value) && value >= 1000 && value <= 10_000_000 ? value : 50000;
};

export class AuditLogRepository {


    /**
     * 添加一条审计日志记录。
     * @param actionType 操作类型。
     * @param details 可选的详细信息（对象或字符串）。
     */
    async addLog(
        actionType: AuditLogActionType,
        details?: Record<string, any> | string | null,
        metadata: Partial<AuditContext> & { assetId?: number; sessionId?: string; result?: AuditLogEntry['result'] } = {},
    ): Promise<void> {
        const timestamp = Math.floor(Date.now() / 1000); 
        let detailsString: string | null = null;

        if (details) {
            try {
                detailsString = typeof details === 'string' ? details : JSON.stringify(details);
            } catch (error: any) {
                console.error(`[审计日志] 序列化操作 ${actionType} 的详情失败:`, error.message);
                detailsString = JSON.stringify({ error: 'Failed to stringify details', originalDetails: String(details) }); // Ensure originalDetails is stringifiable
            }
        }

        const sql = `INSERT INTO audit_logs (
            timestamp, action_type, details, request_id, actor_user_id, actor_username,
            actor_role, source_ip, asset_id, session_id, result
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const params = [
            timestamp, actionType, detailsString, metadata.requestId ?? null, metadata.actorUserId ?? null,
            metadata.actorUsername ?? null, metadata.actorRole ?? null, metadata.sourceIp ?? null,
            metadata.assetId ?? null, metadata.sessionId ?? null, metadata.result ?? 'success',
        ];

        try {
            const db = await getDbInstance();
            await runDb(db, sql, params);

            // --- 添加日志清理逻辑 ---
            await this.cleanupOldLogs(db);
            // --- 清理逻辑结束 ---

        } catch (err: any) {
            console.error(`[审计日志] 添加操作 ${actionType} 的日志条目时出错: ${err.message}`);
            // 决定日志记录失败是应该抛出错误还是仅记录日志
        }
    }

    /**
     * 清理旧的审计日志，保持最多 MAX_LOG_ENTRIES 条记录。
     * @param db - 数据库实例。
     */
    private async cleanupOldLogs(db: Database): Promise<void> {
        const now = Date.now();
        if (now - lastAuditCleanupAt < AUDIT_CLEANUP_INTERVAL_MS) return;
        lastAuditCleanupAt = now;
        const maxLogEntries = readMaxAuditEntries();
        const countSql = 'SELECT COUNT(*) as total FROM audit_logs';
        const deleteSql = `
            DELETE FROM audit_logs
            WHERE id IN (
                SELECT id
                FROM audit_logs
                ORDER BY timestamp ASC
                LIMIT ?
            )
        `; // 假设有自增的 id 列，并且 timestamp 能准确反映顺序

        try {
            const countRow = await getDbRow<{ total: number }>(db, countSql);
            const total = countRow?.total ?? 0;

            if (total > maxLogEntries) {
                const logsToDelete = total - maxLogEntries;
                console.log(`[审计日志] 日志数量 (${total}) 超过限制 (${maxLogEntries})。正在删除 ${logsToDelete} 条最旧的记录。`);
                await runDb(db, deleteSql, [logsToDelete]);
            }
        } catch (err: any) {
            console.error(`[审计日志] 日志清理过程中出错: ${err.message}`);
            // 清理失败不应阻止主日志记录流程，仅记录错误。
        }
    }

    /**
     * 获取审计日志列表（支持分页和基本过滤）。
     * @param limit 每页数量。
     * @param offset 偏移量。
     * @param actionType 可选的操作类型过滤。
     * @param startDate 可选的开始时间戳（秒）。
     * @param endDate 可选的结束时间戳（秒）。
     * @param searchTerm 可选的搜索关键词（模糊匹配 details）。
     */
    async getLogs(
        limit: number = 50,
        offset: number = 0,
        actionType?: AuditLogActionType,
        startDate?: number,
        endDate?: number,
        searchTerm?: string,
        result?: AuditLogEntry['result'],
    ): Promise<{ logs: AuditLogEntry[], total: number }> {
    
        let baseSql = 'SELECT * FROM audit_logs';
        let countSql = 'SELECT COUNT(*) as total FROM audit_logs';
        const whereClauses: string[] = [];
        const params: (string | number)[] = [];
        const countParams: (string | number)[] = [];

        if (actionType) {
            whereClauses.push('action_type = ?');
            params.push(actionType);
            countParams.push(actionType);
        }
        if (startDate !== undefined) {
            whereClauses.push('timestamp >= ?'); params.push(startDate); countParams.push(startDate);
        }
        if (endDate !== undefined) {
            whereClauses.push('timestamp <= ?'); params.push(endDate); countParams.push(endDate);
        }
        if (result) {
            whereClauses.push('result = ?'); params.push(result); countParams.push(result);
        }
        // 添加 searchTerm 的过滤逻辑
        if (searchTerm) {
            whereClauses.push(`(details LIKE ? OR actor_username LIKE ? OR source_ip LIKE ?
                OR request_id LIKE ? OR session_id LIKE ?)`);
            const searchTermLike = `%${searchTerm}%`;
            params.push(searchTermLike, searchTermLike, searchTermLike, searchTermLike, searchTermLike);
            countParams.push(searchTermLike, searchTermLike, searchTermLike, searchTermLike, searchTermLike);
        }


        if (whereClauses.length > 0) {
            const whereSql = ` WHERE ${whereClauses.join(' AND ')}`;
            baseSql += whereSql;
            countSql += whereSql;
        }

        baseSql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);


        try {
            const db = await getDbInstance();
            const countRow = await getDbRow<{ total: number }>(db, countSql, countParams);
            const total = countRow?.total ?? 0;

            const logs = await allDb<DbAuditLogRow>(db, baseSql, params);

            return { logs, total };
        } catch (err: any) {
            console.error(`获取审计日志时出错:`, err.message);
            throw new Error(`获取审计日志时出错: ${err.message}`);
        }
    }
}



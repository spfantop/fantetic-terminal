import { AuditLogRepository } from '../audit/audit.repository';
import { AuditLogActionType, AuditLogEntry } from '../types/audit.types';
import { AuditContext, readAuditContext } from './audit-context';

export const resolveAuditResult = (
    actionType: AuditLogActionType,
    details?: Record<string, any> | string | null,
): AuditLogEntry['result'] => {
    if (details && typeof details === 'object'
        && (details.result === 'failure' || details.result === 'denied')) return details.result;
    if (actionType.includes('UNAUTHORIZED')) return 'denied';
    if (actionType.includes('FAILURE')) return 'failure';
    return 'success';
};

export type AuditLogWriteResult =
    | { written: true; cleanup: 'skipped' | 'succeeded' | 'failed'; cleanupError?: Error }
    | { written: false; error: Error };

export interface AuditLogWriter {
    addLog(
        actionType: AuditLogActionType,
        details?: Record<string, any> | string | null,
        metadata?: Partial<AuditContext> & {
            assetId?: number;
            sessionId?: string;
            result?: AuditLogEntry['result'];
        },
    ): Promise<{ cleanup: 'skipped' | 'succeeded' | 'failed'; cleanupError?: Error } | void>;
    getLogs?(
        limit?: number,
        offset?: number,
        actionType?: AuditLogActionType,
        startDate?: number,
        endDate?: number,
        searchTerm?: string,
        result?: AuditLogEntry['result'],
    ): Promise<{ logs: AuditLogEntry[]; total: number }>;
}

export class AuditLogService {
    private repository: AuditLogWriter;

    constructor(
        repository: AuditLogWriter = new AuditLogRepository(),
        private readonly reportFailure: (error: unknown) => void = error => {
            console.error('[Audit Service] 审计日志操作失败:', error);
        },
    ) {
        this.repository = repository;
    }

    /**
     * 记录一条审计日志
     * @param actionType 操作类型
     * @param details 可选的详细信息 (对象或字符串)
     */
    async logAction(
        actionType: AuditLogActionType,
        details?: Record<string, any> | string | null,
    ): Promise<AuditLogWriteResult> {
        // 在这里可以添加额外的逻辑，例如：
        // - 检查是否需要记录此类型的日志 (基于配置)
        // - 格式化 details
        // - 异步执行，不阻塞主流程
        try {
            // 使用 'await' 确保日志记录完成（如果需要保证顺序或处理错误）
            // 或者不使用 'await' 让其在后台执行
            const objectDetails = details && typeof details === 'object' ? details : undefined;
            const rawAssetId = objectDetails?.assetId ?? objectDetails?.connectionId;
            const assetId = Number.isInteger(Number(rawAssetId)) ? Number(rawAssetId) : undefined;
            const sessionId = typeof objectDetails?.sessionId === 'string' ? objectDetails.sessionId : undefined;
            const result = resolveAuditResult(actionType, details);
            const repositoryResult = await this.repository.addLog(actionType, details, {
                ...readAuditContext(), assetId, sessionId, result,
            });
            return {
                written: true,
                cleanup: repositoryResult?.cleanup ?? 'skipped',
                ...(repositoryResult?.cleanupError ? { cleanupError: repositoryResult.cleanupError } : {}),
            };
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            this.reportFailure(normalizedError);
            return { written: false, error: normalizedError };
        }
    }

    async logActionOrThrow(
        actionType: AuditLogActionType,
        details?: Record<string, any> | string | null,
    ): Promise<Extract<AuditLogWriteResult, { written: true }>> {
        const result = await this.logAction(actionType, details);
        if (!result.written) throw result.error;
        return result;
    }

     /**
     * 获取审计日志列表
     * @param limit 每页数量
     * @param offset 偏移量
     * @param actionType 可选的操作类型过滤
     * @param startDate 可选的开始时间戳 (秒)
     * @param endDate 可选的结束时间戳 (秒)
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
        // 将 searchTerm 传递给 repository
        if (!this.repository.getLogs) throw new Error('Audit log reader is unavailable.');
        return this.repository.getLogs(limit, offset, actionType, startDate, endDate, searchTerm, result);
    }
}

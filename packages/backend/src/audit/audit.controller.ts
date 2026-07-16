import { Request, Response } from 'express';
import { AuditLogService } from './audit.service';
import { AuditLogActionType } from '../types/audit.types';
import { sendApiError } from '../security/api-error-envelope';

const auditLogService = new AuditLogService();
const MAX_AUDIT_PAGE_SIZE = 200;
const MAX_AUDIT_SEARCH_LENGTH = 200;

export class AuditController {
    /**
     * 获取审计日志列表 (GET /api/v1/audit-logs)
     * 支持分页和过滤查询参数: limit, offset, actionType, startDate, endDate
     */
    async getAuditLogs(req: Request, res: Response): Promise<void> {
        try {
            // 解析查询参数
            const limit = parseInt(req.query.limit as string || '50', 10);
            const offset = parseInt(req.query.offset as string || '0', 10);
            // 修正：从 req.query 中读取 action_type (snake_case)
            const actionType = req.query.action_type as AuditLogActionType | undefined;
            const startDate = req.query.startDate ? parseInt(req.query.startDate as string, 10) : undefined;
            const endDate = req.query.endDate ? parseInt(req.query.endDate as string, 10) : undefined;
            // 解析 searchTerm 参数
            const searchTerm = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
            const resultFilter = typeof req.query.result === 'string' ? req.query.result as 'success' | 'failure' | 'denied' : undefined;


            // 输入验证 (基本)
            if (isNaN(limit) || limit <= 0 || limit > MAX_AUDIT_PAGE_SIZE) {
                sendApiError(res, 400, 'validation.invalidLimit');
                return;
            }
            if (isNaN(offset) || offset < 0) {
                sendApiError(res, 400, 'validation.invalidOffset');
                return;
            }
            if (searchTerm && searchTerm.length > MAX_AUDIT_SEARCH_LENGTH) {
                sendApiError(res, 400, 'validation.invalidSearch');
                return;
            }
            if (startDate && isNaN(startDate)) {
                 sendApiError(res, 400, 'validation.invalidDate');
                return;
            }
             if (endDate && isNaN(endDate)) {
                 sendApiError(res, 400, 'validation.invalidDate');
                return;
            }

            // 将 searchTerm 传递给 service
            const result = await auditLogService.getLogs(limit, offset, actionType, startDate, endDate, searchTerm, resultFilter);

            // 解析 details 字段从 JSON 字符串到对象（如果需要）
            const logsWithParsedDetails = result.logs.map(log => {
                let parsedDetails: any = null;
                if (log.details) {
                    try {
                        parsedDetails = JSON.parse(log.details);
                    } catch (e) {
                        console.warn(`[Audit Log] Failed to parse details for log ID ${log.id}:`, e);
                        parsedDetails = { raw: log.details, parseError: true };
                    }
                }
                return { ...log, details: parsedDetails };
            });


            res.status(200).json({
                logs: logsWithParsedDetails,
                total: result.total,
                limit,
                offset
            });
        } catch (error: any) {
            console.error('获取审计日志时出错:', error);
            sendApiError(res, 500, 'audit.logListFailed');
        }
    }
}

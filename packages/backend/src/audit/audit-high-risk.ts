import { AuditLogActionType } from '../types/audit.types';
import type { AuditLogWriteResult } from './audit.service';

export interface FailClosedAuditWriter {
  logActionOrThrow(
    actionType: AuditLogActionType,
    details?: Record<string, unknown> | string | null,
  ): Promise<Extract<AuditLogWriteResult, { written: true }>>;
}

/**
 * Records an immutable intent before a high-risk mutation starts. The intent is
 * deliberately separate from the eventual result: a later business failure is
 * not rewritten into the append-only record.
 */
export const runAuditProtectedOperation = async <T>(
  audit: FailClosedAuditWriter,
  actionType: AuditLogActionType,
  details: Record<string, unknown> | string | null | undefined,
  operation: () => Promise<T>,
): Promise<T> => {
  await audit.logActionOrThrow(actionType, details);
  return operation();
};

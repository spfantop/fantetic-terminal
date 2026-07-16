import { Request, Response } from 'express';

import { AuditLogService } from '../audit/audit.service';
import { runAuditProtectedOperation } from '../audit/audit-high-risk';
import { createLogger } from '../logging/logger';
import { resolveBackupScheduleConfig } from './backup.scheduler';
import { getBackupService } from './backup.runtime';

const audit = new AuditLogService();
const logger = createLogger('BackupController');

const fail = (res: Response, error: unknown): void => {
  logger.error('备份操作失败', { error });
  res.status(400).json({ code: 'backup.operationFailed' });
};

export const listBackups = (_req: Request, res: Response): void => {
  try { res.json(getBackupService().listBackups()); } catch (error) { fail(res, error); }
};

export const readBackupCount = (_req: Request, res: Response): void => {
  try { res.json({ total: getBackupService().countBackups() }); } catch (error) { fail(res, error); }
};

export const createBackup = async (_req: Request, res: Response): Promise<void> => {
  try {
    const backup = await runAuditProtectedOperation(audit, 'BACKUP_CREATED', { phase: 'requested' },
      () => getBackupService().createBackupWithPolicy(resolveBackupScheduleConfig()));
    res.status(201).json(backup);
  } catch (error) { fail(res, error); }
};

export const verifyBackup = async (req: Request, res: Response): Promise<void> => {
  try { res.json(await getBackupService().verifyBackup(req.params.backupId)); } catch (error) { fail(res, error); }
};

export const scheduleRestore = async (req: Request, res: Response): Promise<void> => {
  try {
    await runAuditProtectedOperation(audit, 'BACKUP_RESTORE_SCHEDULED', {
      backupId: req.params.backupId, phase: 'requested',
    }, () => getBackupService().scheduleRestore(req.params.backupId));
    res.status(202).json({ code: 'backup.restoreScheduled', restartRequired: true });
  } catch (error) { fail(res, error); }
};

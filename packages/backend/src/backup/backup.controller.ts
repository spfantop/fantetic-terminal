import { Request, Response } from 'express';

import { createBackupService } from './backup.service';
import { getAppDataPath } from '../config/app-data-path';
import { backupDatabaseTo, readDatabaseSchemaVersion } from '../database/connection';
import { AuditLogService } from '../audit/audit.service';
import { createLogger } from '../logging/logger';

const service = createBackupService({
  appDataPath: getAppDataPath(),
  snapshotDatabase: backupDatabaseTo,
  readSchemaVersion: readDatabaseSchemaVersion,
});
const audit = new AuditLogService();
const logger = createLogger('BackupController');

const fail = (res: Response, error: unknown): void => {
  logger.error('备份操作失败', { error });
  res.status(400).json({ code: 'backup.operationFailed' });
};

export const listBackups = (_req: Request, res: Response): void => {
  try { res.json(service.listBackups()); } catch (error) { fail(res, error); }
};

export const createBackup = async (_req: Request, res: Response): Promise<void> => {
  try {
    const backup = await service.createBackup();
    await audit.logAction('BACKUP_CREATED', { backupId: backup.id });
    res.status(201).json(backup);
  } catch (error) { fail(res, error); }
};

export const verifyBackup = async (req: Request, res: Response): Promise<void> => {
  try { res.json(await service.verifyBackup(req.params.backupId)); } catch (error) { fail(res, error); }
};

export const scheduleRestore = async (req: Request, res: Response): Promise<void> => {
  try {
    await service.scheduleRestore(req.params.backupId);
    await audit.logAction('BACKUP_RESTORE_SCHEDULED', { backupId: req.params.backupId });
    res.status(202).json({ code: 'backup.restoreScheduled', restartRequired: true });
  } catch (error) { fail(res, error); }
};

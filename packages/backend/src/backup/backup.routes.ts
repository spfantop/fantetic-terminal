import { Router } from 'express';
import { isAuthenticated } from '../auth/auth.middleware';
import { requireSystemAdministrator } from '../access-control/system-administrator.middleware';
import { createBackup, listBackups, readBackupCount, scheduleRestore, verifyBackup } from './backup.controller';

const router = Router();
router.use(isAuthenticated, requireSystemAdministrator);
router.get('/', listBackups);
router.get('/count', readBackupCount);
router.post('/', createBackup);
router.post('/:backupId/verify', verifyBackup);
router.post('/:backupId/restore', scheduleRestore);
export default router;

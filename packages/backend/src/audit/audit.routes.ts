import { Router } from 'express';
import { AuditController } from './audit.controller';
import { isAuthenticated } from '../auth/auth.middleware';
import { requireAuditReader } from '../access-control/audit-reader.middleware';

const router = Router();
const auditController = new AuditController();

router.use(isAuthenticated, requireAuditReader);


router.get('/', auditController.getAuditLogs);

export default router;

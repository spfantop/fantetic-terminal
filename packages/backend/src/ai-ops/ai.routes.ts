import express from 'express';
import { isAuthenticated } from '../auth/auth.middleware';
import * as NL2CMDController from './nl2cmd.controller';

const router = express.Router();

router.use(isAuthenticated);

router.get('/settings', NL2CMDController.getAISettings);
router.post('/settings', NL2CMDController.saveAISettings);
router.post('/test', NL2CMDController.testAIConnection);
router.post('/nl2cmd', NL2CMDController.generateCommand);

export default router;

import { Router } from 'express';
import { isAuthenticated } from '../auth/auth.middleware';
import { listRecordings, readRecording } from './session-recording.controller';

const router = Router();
router.use(isAuthenticated);
router.get('/', listRecordings);
router.get('/:recordingId', readRecording);
export default router;

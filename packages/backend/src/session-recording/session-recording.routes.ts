import { Router } from 'express';
import { isAuthenticated } from '../auth/auth.middleware';
import { deleteRecording, listRecordings, readRecording, streamGuacamoleRecording } from './session-recording.controller';

const router = Router();
router.use(isAuthenticated);
router.get('/', listRecordings);
router.get('/:recordingId/guacamole', streamGuacamoleRecording);
router.get('/:recordingId', readRecording);
router.delete('/:recordingId', deleteRecording);
export default router;

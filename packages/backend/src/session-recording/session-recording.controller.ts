import { Request, Response } from 'express';
import { listReadableRecordings, readRecordingForSubject } from './session-recording.service';

export const listRecordings = async (req: Request, res: Response): Promise<void> => {
  res.json(await listReadableRecordings(req.authorization!));
};

export const readRecording = async (req: Request, res: Response): Promise<void> => {
  const cursor = Number(req.query.cursor ?? 0);
  const limit = Number(req.query.limit ?? 100);
  const recording = await readRecordingForSubject(req.params.recordingId, req.authorization!, cursor, limit);
  if (!recording) {
    res.status(404).json({ code: 'sessionRecording.notFound' });
    return;
  }
  res.json(recording);
};

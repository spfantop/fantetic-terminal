import { Request, Response } from 'express';
import { listReadableRecordings, readRecordingForSubject } from './session-recording.service';

export const listRecordings = async (req: Request, res: Response): Promise<void> => {
  const limit = Number(req.query.limit ?? 25);
  const offset = Number(req.query.offset ?? 0);
  const startedAfter = req.query.startedAfter === undefined ? undefined : Number(req.query.startedAfter);
  const startedBefore = req.query.startedBefore === undefined ? undefined : Number(req.query.startedBefore);
  res.json(await listReadableRecordings(req.authorization!, {
    query: typeof req.query.query === 'string' ? req.query.query : undefined,
    status: typeof req.query.status === 'string' ? req.query.status as 'active' | 'completed' | 'incomplete' | 'failed' : undefined,
    startedAfter: Number.isFinite(startedAfter) ? startedAfter : undefined,
    startedBefore: Number.isFinite(startedBefore) ? startedBefore : undefined,
    limit: Number.isFinite(limit) ? limit : 25,
    offset: Number.isFinite(offset) ? offset : 0,
  }));
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

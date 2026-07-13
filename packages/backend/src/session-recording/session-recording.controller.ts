import { Request, Response } from 'express';
import { deleteRecordingForSubject, listReadableRecordings, readRecordingForSubject } from './session-recording.service';

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

export const deleteRecording = async (req: Request, res: Response): Promise<void> => {
  const result = await deleteRecordingForSubject(req.params.recordingId, req.authorization!);
  if (result === 'not_found') { res.status(404).json({ code: 'sessionRecording.notFound' }); return; }
  if (result === 'forbidden') { res.status(403).json({ code: 'sessionRecording.deleteForbidden' }); return; }
  if (result === 'active') { res.status(409).json({ code: 'sessionRecording.deleteActive' }); return; }
  res.status(204).end();
};

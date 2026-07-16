import { Request, Response } from 'express';
import { sendApiError } from '../security/api-error-envelope';
import {
  deleteRecordingForSubject,
  listReadableRecordings,
  prepareGuacamoleRecordingStreamForSubject,
  readRecordingForSubject,
} from './session-recording.service';

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

export const streamGuacamoleRecording = async (req: Request, res: Response): Promise<void> => {
  const prepared = await prepareGuacamoleRecordingStreamForSubject(req.params.recordingId, req.authorization!);
  if (prepared.status !== 'ready') {
    if (prepared.status === 'not_found') { sendApiError(res, 404, 'sessionRecording.notFound'); return; }
    if (prepared.status === 'forbidden') { sendApiError(res, 403, 'sessionRecording.readForbidden'); return; }
    if (prepared.status === 'unsupported_protocol') { sendApiError(res, 422, 'sessionRecording.guacamoleProtocolRequired'); return; }
    if (prepared.status === 'integrity_failed') { sendApiError(res, 409, 'sessionRecording.integrityFailed'); return; }
    sendApiError(res, 409, 'sessionRecording.notReady');
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    for await (const chunk of prepared.chunkIterator) {
      res.write(chunk);
    }
    res.end();
  } catch {
    if (!res.headersSent) {
      sendApiError(res, 500, 'sessionRecording.streamFailed');
      return;
    }
    res.destroy();
  }
};

export const deleteRecording = async (req: Request, res: Response): Promise<void> => {
  const result = await deleteRecordingForSubject(req.params.recordingId, req.authorization!);
  if (result === 'not_found') { res.status(404).json({ code: 'sessionRecording.notFound' }); return; }
  if (result === 'forbidden') { res.status(403).json({ code: 'sessionRecording.deleteForbidden' }); return; }
  if (result === 'active') { res.status(409).json({ code: 'sessionRecording.deleteActive' }); return; }
  res.status(204).end();
};

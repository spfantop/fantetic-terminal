import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { getAppDataPath } from '../config/app-data-path';
import { createSessionRecorder, readRecordingEventPage } from './session-recorder';
import {
  completeSessionRecording,
  insertSessionRecording,
  listSessionRecordings,
  readSessionRecording,
  SessionRecordingRow,
} from './session-recording.repository';

export interface SessionRecordingIdentity {
  userId?: number;
  username?: string;
  connectionId: number;
  connectionName: string;
  protocol: 'SSH' | 'TELNET';
}

export type ActiveSessionRecorder = ReturnType<typeof createSessionRecorder>;
const recordingRoot = path.join(getAppDataPath(), 'session-recordings');

export const startSessionRecording = async (
  identity: SessionRecordingIdentity,
): Promise<ActiveSessionRecorder | undefined> => {
  if (process.env.SESSION_RECORDING_ENABLED === 'false') return undefined;
  const id = uuidv4();
  const startedAt = Date.now();
  let endedAt = startedAt;
  const recorder = createSessionRecorder({
    rootPath: recordingRoot,
    recordingId: id,
    startedAt,
    now: Date.now,
    onComplete: async summary => {
      await completeSessionRecording(
        id,
        endedAt,
        summary.incomplete ? 'incomplete' : 'completed',
        summary.eventCount,
        summary.byteCount,
      );
    },
  });
  await insertSessionRecording({
    id,
    user_id: identity.userId ?? null,
    username: identity.username ?? null,
    connection_id: identity.connectionId,
    connection_name: identity.connectionName,
    protocol: identity.protocol,
    started_at: startedAt,
    ended_at: null,
    status: 'active',
    relative_path: recorder.relativePath,
    event_count: 0,
    byte_count: 0,
  });
  const originalFinish = recorder.finish;
  recorder.finish = async finishAt => {
    endedAt = finishAt;
    await originalFinish(finishAt);
  };
  return recorder;
};

export const finishSessionRecording = async (recorder?: ActiveSessionRecorder): Promise<void> => {
  if (!recorder) return;
  try { await recorder.finish(Date.now()); } catch (error) {
    console.error('[SessionRecording] 结束录像失败:', error);
  }
};

export const canReadRecording = (
  row: SessionRecordingRow,
  subject: { runtime: string; systemRole: string; userId?: number },
): boolean => subject.runtime === 'desktop'
  || ['super_admin', 'admin', 'auditor'].includes(subject.systemRole)
  || row.user_id === subject.userId;

export const listReadableRecordings = async (
  subject: { runtime: string; systemRole: string; userId?: number },
): Promise<SessionRecordingRow[]> => (
  subject.runtime === 'desktop' || ['super_admin', 'admin', 'auditor'].includes(subject.systemRole)
    ? listSessionRecordings()
    : listSessionRecordings(subject.userId)
);

export const readRecordingForSubject = async (
  id: string,
  subject: { runtime: string; systemRole: string; userId?: number },
  cursor = 0,
  limit = 100,
) => {
  const row = await readSessionRecording(id);
  if (!row || !canReadRecording(row, subject)) return undefined;
  return { metadata: row, ...await readRecordingEventPage(recordingRoot, row.relative_path, cursor, limit) };
};

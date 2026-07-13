import { allDb, getDb, getDbInstance, runDb } from '../database/connection';
import type { SessionRecordingMetadata } from '@fantetic-terminal/contracts';

export type SessionRecordingRow = SessionRecordingMetadata;

export const insertSessionRecording = async (row: SessionRecordingRow): Promise<void> => {
  const db = await getDbInstance();
  await runDb(db, `INSERT INTO session_recordings (
    id, user_id, username, connection_id, connection_name, protocol,
    started_at, status, relative_path, event_count, byte_count
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    row.id, row.user_id, row.username, row.connection_id, row.connection_name, row.protocol,
    row.started_at, row.status, row.relative_path, row.event_count, row.byte_count,
  ]);
};

export const completeSessionRecording = async (
  id: string,
  endedAt: number,
  status: SessionRecordingRow['status'],
  eventCount: number,
  byteCount: number,
): Promise<void> => {
  const db = await getDbInstance();
  await runDb(db, `UPDATE session_recordings
    SET ended_at = ?, status = ?, event_count = ?, byte_count = ? WHERE id = ?`,
  [endedAt, status, eventCount, byteCount, id]);
};

export const listSessionRecordings = async (userId?: number): Promise<SessionRecordingRow[]> => {
  const db = await getDbInstance();
  const where = userId === undefined ? '' : 'WHERE user_id = ?';
  return allDb(db, `SELECT * FROM session_recordings ${where} ORDER BY started_at DESC LIMIT 500`,
    userId === undefined ? [] : [userId]);
};

export const readSessionRecording = async (id: string): Promise<SessionRecordingRow | undefined> => {
  const db = await getDbInstance();
  return getDb(db, 'SELECT * FROM session_recordings WHERE id = ?', [id]);
};

export const markInterruptedSessionRecordings = async (): Promise<number> => {
  const db = await getDbInstance();
  const result = await runDb(db, `UPDATE session_recordings
    SET status = 'incomplete', ended_at = COALESCE(ended_at, strftime('%s', 'now') * 1000)
    WHERE status = 'active'`);
  return result.changes;
};

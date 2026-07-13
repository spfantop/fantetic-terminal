import { allDb, getDb, getDbInstance, runDb } from '../database/connection';
import type { SessionRecordingListQuery, SessionRecordingMetadata } from '@fantetic-terminal/contracts';

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

export const listSessionRecordings = async (query: SessionRecordingListQuery & { userId?: number } = {}) => {
  const db = await getDbInstance();
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (query.userId !== undefined) { clauses.push('user_id = ?'); params.push(query.userId); }
  if (query.query?.trim()) {
    clauses.push('(LOWER(connection_name) LIKE ? OR LOWER(COALESCE(username, \'\')) LIKE ?)');
    const search = `%${query.query.trim().toLocaleLowerCase()}%`;
    params.push(search, search);
  }
  if (query.status) { clauses.push('status = ?'); params.push(query.status); }
  if (query.startedAfter !== undefined) { clauses.push('started_at >= ?'); params.push(query.startedAfter); }
  if (query.startedBefore !== undefined) { clauses.push('started_at <= ?'); params.push(query.startedBefore); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(100, Math.max(1, query.limit ?? 25));
  const offset = Math.max(0, query.offset ?? 0);
  const [itemList, count] = await Promise.all([
    allDb<SessionRecordingRow>(db, `SELECT * FROM session_recordings ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]),
    getDb<{ total: number }>(db, `SELECT COUNT(*) AS total FROM session_recordings ${where}`, params),
  ]);
  return { itemList, total: count?.total ?? 0, limit, offset };
};

export const readSessionRecording = async (id: string): Promise<SessionRecordingRow | undefined> => {
  const db = await getDbInstance();
  return getDb(db, 'SELECT * FROM session_recordings WHERE id = ?', [id]);
};

export const deleteSessionRecording = async (id: string): Promise<boolean> => {
  const db = await getDbInstance();
  return (await runDb(db, 'DELETE FROM session_recordings WHERE id = ?', [id])).changes > 0;
};

export const markInterruptedSessionRecordings = async (): Promise<number> => {
  const db = await getDbInstance();
  const result = await runDb(db, `UPDATE session_recordings
    SET status = 'incomplete', ended_at = COALESCE(ended_at, strftime('%s', 'now') * 1000)
    WHERE status = 'active'`);
  return result.changes;
};

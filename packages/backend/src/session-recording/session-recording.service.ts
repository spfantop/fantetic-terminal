import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { getAppDataPath } from '../config/app-data-path';
import {
  createSessionRecorder,
  readGuacamoleServerRecordingChunks,
  readRecordingEventPage,
} from './session-recorder';
import { resolveSessionRecordingIntegrity } from './recording-integrity';
import { recordingIntegrityCache } from './recording-integrity-cache';
import {
  completeSessionRecording,
  deleteSessionRecording,
  insertSessionRecording,
  listSessionRecordings,
  listSessionRecordingsForCapacity,
  readSessionRecording,
  SessionRecordingRow,
} from './session-recording.repository';
import {
  isRecordingPathInsideRoot,
  readAvailableBytes,
  resolveRecordingCapacityConfig,
  selectRecordingsForPrune,
} from './recording-capacity';
import { backendMetrics } from '../observability/metrics';
import { settingsRepository } from '../settings/settings.repository';
import { createLogger } from '../logging/logger';
import type { SessionRecordingListQuery } from '@fantetic-terminal/contracts';
import type { SessionRecordingProtocol } from '@fantetic-terminal/contracts';

const logger = createLogger('SessionRecordingService');
const SESSION_RECORDING_ENABLED_KEY = 'sessionRecordingEnabled';

export interface SessionRecordingIdentity {
  userId?: number;
  username?: string;
  connectionId: number;
  connectionName: string;
  protocol: SessionRecordingProtocol;
  clientKind?: 'mobile';
}

export type ActiveSessionRecorder = ReturnType<typeof createSessionRecorder>;
const recordingRoot = path.join(getAppDataPath(), 'session-recordings');
let capacityEnforcementPromise: Promise<boolean> | undefined;

const enforceRecordingCapacityInternal = async (): Promise<boolean> => {
  fs.mkdirSync(recordingRoot, { recursive: true });
  const config = resolveRecordingCapacityConfig();
  const pruneList = selectRecordingsForPrune(
    (await listSessionRecordingsForCapacity()).map(recording => ({
      id: recording.id,
      status: recording.status,
      endedAt: recording.ended_at,
      byteCount: recording.byte_count,
      relativePath: recording.relative_path,
    })),
    config,
  );
  for (const recording of pruneList) {
    if (!isRecordingPathInsideRoot(recordingRoot, recording.relativePath)) {
      logger.warn('录像路径超出存储目录，已跳过自动清理', { recordingId: recording.id });
      continue;
    }
    await fs.promises.rm(path.resolve(recordingRoot, recording.relativePath), { force: true });
    await deleteSessionRecording(recording.id);
    backendMetrics.recordRecordingCapacityOutcome('pruned');
  }
  const availableBytes = readAvailableBytes(recordingRoot);
  backendMetrics.setDataFreeBytes(availableBytes);
  if (availableBytes < config.minimumFreeBytes) {
    backendMetrics.recordRecordingCapacityOutcome('skipped_low_disk');
    logger.warn('可用磁盘空间不足，已跳过新增会话录像', {
      availableBytes,
      minimumFreeBytes: config.minimumFreeBytes,
    });
    return false;
  }
  return true;
};

const enforceRecordingCapacity = (): Promise<boolean> => {
  if (capacityEnforcementPromise) return capacityEnforcementPromise;
  capacityEnforcementPromise = enforceRecordingCapacityInternal()
    .finally(() => { capacityEnforcementPromise = undefined; });
  return capacityEnforcementPromise;
};

export const startSessionRecording = async (
  identity: SessionRecordingIdentity,
): Promise<ActiveSessionRecorder | undefined> => {
  if (identity.clientKind === 'mobile') return undefined;
  if (await settingsRepository.getSetting(SESSION_RECORDING_ENABLED_KEY) === 'false') return undefined;
  try {
    if (!await enforceRecordingCapacity()) return undefined;
  } catch (error) {
    logger.error('检查会话录像容量失败，已跳过新增录像', { error });
    return undefined;
  }
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
        summary.finalHash,
        summary.batchCount,
      );
    },
  });
  backendMetrics.recordRecordingCapacityOutcome('started');
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
    recording_chain_hash: null,
    recording_batch_count: 0,
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
  try {
    await recorder.finish(Date.now());
    await enforceRecordingCapacity();
  } catch (error) {
    logger.error('结束录像失败', { error });
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
  query: SessionRecordingListQuery = {},
) => (
  subject.runtime === 'desktop' || ['super_admin', 'admin', 'auditor'].includes(subject.systemRole)
    ? listSessionRecordings(query)
    : listSessionRecordings({ ...query, userId: subject.userId })
);

export const readRecordingForSubject = async (
  id: string,
  subject: { runtime: string; systemRole: string; userId?: number },
  cursor = 0,
  limit = 100,
) => {
  const row = await readSessionRecording(id);
  if (!row || !canReadRecording(row, subject)) return undefined;
  const integrity = resolveSessionRecordingIntegrity(
    row,
    await recordingIntegrityCache.verify(recordingRoot, row.relative_path),
  );
  if (integrity.status === 'invalid') {
    return { metadata: row, integrity, eventList: [], nextCursor: null };
  }
  return { metadata: row, integrity, ...await readRecordingEventPage(recordingRoot, row.relative_path, cursor, limit) };
};

export type GuacamoleRecordingStreamPreparation =
  | { status: 'ready'; chunkIterator: AsyncIterable<Buffer> }
  | { status: 'not_found' | 'forbidden' | 'unsupported_protocol' | 'integrity_failed' | 'not_ready' };

export const prepareGuacamoleRecordingStreamForSubject = async (
  id: string,
  subject: { runtime: string; systemRole: string; userId?: number },
): Promise<GuacamoleRecordingStreamPreparation> => {
  const row = await readSessionRecording(id);
  if (!row) return { status: 'not_found' };
  if (!canReadRecording(row, subject)) return { status: 'forbidden' };
  if (row.protocol !== 'RDP' && row.protocol !== 'VNC') return { status: 'unsupported_protocol' };

  const integrity = resolveSessionRecordingIntegrity(
    row,
    await recordingIntegrityCache.verify(recordingRoot, row.relative_path),
  );
  if (integrity.status === 'invalid') return { status: 'integrity_failed' };
  if (integrity.status === 'unanchored') return { status: 'not_ready' };
  return {
    status: 'ready',
    chunkIterator: readGuacamoleServerRecordingChunks(recordingRoot, row.relative_path),
  };
};

export const deleteRecordingForSubject = async (
  id: string,
  subject: { runtime: string; systemRole: string; userId?: number },
): Promise<'deleted' | 'not_found' | 'active' | 'forbidden'> => {
  const row = await readSessionRecording(id);
  if (!row) return 'not_found';
  if (subject.runtime !== 'desktop' && !['super_admin', 'admin'].includes(subject.systemRole)) return 'forbidden';
  if (row.status === 'active') return 'active';
  const root = path.resolve(recordingRoot);
  const target = path.resolve(root, row.relative_path);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return 'forbidden';
  await fs.promises.rm(target, { force: true });
  await deleteSessionRecording(id);
  return 'deleted';
};

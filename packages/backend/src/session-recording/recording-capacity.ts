import fs from 'node:fs';
import path from 'node:path';

export type RecordingCapacityConfig = {
  retentionDays: number;
  maxTotalBytes: number;
  minimumFreeBytes: number;
};

export type RetainableRecording = {
  id: string;
  status: 'completed' | 'incomplete' | 'failed' | 'active';
  endedAt: number | null;
  byteCount: number;
  relativePath: string;
};

const DEFAULT_MINIMUM_FREE_BYTES = 512 * 1024 * 1024;

const readNonNegativeInteger = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

export const resolveRecordingCapacityConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): RecordingCapacityConfig => ({
  retentionDays: readNonNegativeInteger(environment.RECORDING_RETENTION_DAYS, 0),
  maxTotalBytes: readNonNegativeInteger(environment.RECORDING_MAX_TOTAL_BYTES, 0),
  minimumFreeBytes: readNonNegativeInteger(environment.RECORDING_MIN_FREE_BYTES, DEFAULT_MINIMUM_FREE_BYTES),
});

export const readAvailableBytes = (directoryPath: string): number => {
  const stats = fs.statfsSync(directoryPath);
  const available = Number(stats.bavail) * Number(stats.bsize);
  if (!Number.isFinite(available) || available < 0) {
    throw new Error('Unable to determine available recording disk space.');
  }
  return available;
};

export const isRecordingPathInsideRoot = (rootPath: string, relativePath: string): boolean => {
  if (!relativePath || path.isAbsolute(relativePath)) return false;
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath);
  return target !== root && target.startsWith(`${root}${path.sep}`);
};

export const selectRecordingsForPrune = (
  recordingList: RetainableRecording[],
  config: RecordingCapacityConfig,
  now = Date.now(),
): RetainableRecording[] => {
  const completedList = recordingList
    .filter(recording => recording.status !== 'active')
    .sort((left, right) => (left.endedAt ?? 0) - (right.endedAt ?? 0));
  const selectedIdSet = new Set<string>();
  const retentionThreshold = config.retentionDays > 0
    ? now - config.retentionDays * 24 * 60 * 60 * 1000
    : undefined;

  if (retentionThreshold !== undefined) {
    for (const recording of completedList) {
      if ((recording.endedAt ?? now) < retentionThreshold) selectedIdSet.add(recording.id);
    }
  }

  if (config.maxTotalBytes > 0) {
    let retainedBytes = completedList
      .filter(recording => !selectedIdSet.has(recording.id))
      .reduce((total, recording) => total + Math.max(0, recording.byteCount), 0);
    for (const recording of completedList) {
      if (retainedBytes <= config.maxTotalBytes) break;
      if (selectedIdSet.has(recording.id)) continue;
      selectedIdSet.add(recording.id);
      retainedBytes -= Math.max(0, recording.byteCount);
    }
  }

  return completedList.filter(recording => selectedIdSet.has(recording.id));
};

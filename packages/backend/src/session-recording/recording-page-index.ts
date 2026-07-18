import { readRecordingFileFingerprint } from './recording-file';

export interface RecordingPageCheckpoint {
  lineIndex: number;
  byteOffset: number;
}

interface RecordingPageIndexEntry {
  fingerprint: string;
  checkpointByLine: Map<number, number>;
}

export const createRecordingPageIndexCache = ({
  readFingerprint = readRecordingFileFingerprint,
  maxEntries = 128,
  maxCheckpointsPerEntry = 4_096,
}: {
  readFingerprint?: (rootPath: string, relativePath: string) => Promise<string>;
  maxEntries?: number;
  maxCheckpointsPerEntry?: number;
} = {}) => {
  const entryLimit = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : 128;
  const checkpointLimit = Number.isFinite(maxCheckpointsPerEntry)
    ? Math.max(2, Math.floor(maxCheckpointsPerEntry))
    : 4_096;
  const entryByPath = new Map<string, RecordingPageIndexEntry>();

  const touch = (cacheKey: string, entry: RecordingPageIndexEntry): void => {
    entryByPath.delete(cacheKey);
    entryByPath.set(cacheKey, entry);
    while (entryByPath.size > entryLimit) {
      const oldestKey = entryByPath.keys().next().value;
      if (oldestKey === undefined) break;
      entryByPath.delete(oldestKey);
    }
  };

  const open = async (rootPath: string, relativePath: string) => {
    const cacheKey = `${rootPath}\0${relativePath}`;
    const fingerprint = await readFingerprint(rootPath, relativePath);
    let entry = entryByPath.get(cacheKey);
    if (!entry || entry.fingerprint !== fingerprint) {
      entry = { fingerprint, checkpointByLine: new Map([[0, 0]]) };
    }
    touch(cacheKey, entry);

    return {
      find(targetLineIndex: number): RecordingPageCheckpoint {
        let checkpoint = { lineIndex: 0, byteOffset: 0 };
        for (const [lineIndex, byteOffset] of entry.checkpointByLine) {
          if (lineIndex <= targetLineIndex && lineIndex >= checkpoint.lineIndex) {
            checkpoint = { lineIndex, byteOffset };
          }
        }
        return checkpoint;
      },
      remember(lineIndex: number, byteOffset: number): void {
        if (lineIndex < 0 || byteOffset < 0) return;
        entry.checkpointByLine.delete(lineIndex);
        entry.checkpointByLine.set(lineIndex, byteOffset);
        while (entry.checkpointByLine.size > checkpointLimit) {
          const oldestNonZeroLine = [...entry.checkpointByLine.keys()].find(key => key !== 0);
          if (oldestNonZeroLine === undefined) break;
          entry.checkpointByLine.delete(oldestNonZeroLine);
        }
      },
    };
  };

  return { open };
};

export const recordingPageIndexCache = createRecordingPageIndexCache();

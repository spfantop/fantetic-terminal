import {
  verifyRecordingIntegrity,
  type RecordingIntegrityResult,
} from './session-recorder';
import { readRecordingFileFingerprint } from './recording-file';

interface IntegrityCacheEntry {
  fingerprint: string;
  result: RecordingIntegrityResult;
}

export const createRecordingIntegrityCache = ({
  readFingerprint = readRecordingFileFingerprint,
  verify = verifyRecordingIntegrity,
  maxEntries = 128,
}: {
  readFingerprint?: (rootPath: string, relativePath: string) => Promise<string>;
  verify?: (rootPath: string, relativePath: string) => Promise<RecordingIntegrityResult>;
  maxEntries?: number;
} = {}) => {
  const entryLimit = Math.max(1, Math.floor(maxEntries));
  const cacheByPath = new Map<string, IntegrityCacheEntry>();
  const inFlightByFingerprint = new Map<string, Promise<RecordingIntegrityResult>>();

  const remember = (cacheKey: string, entry: IntegrityCacheEntry): void => {
    cacheByPath.delete(cacheKey);
    cacheByPath.set(cacheKey, entry);
    while (cacheByPath.size > entryLimit) {
      const oldestKey = cacheByPath.keys().next().value;
      if (oldestKey === undefined) break;
      cacheByPath.delete(oldestKey);
    }
  };

  const verifyCached = async (
    rootPath: string,
    relativePath: string,
  ): Promise<RecordingIntegrityResult> => {
    const cacheKey = `${rootPath}\0${relativePath}`;
    const fingerprint = await readFingerprint(rootPath, relativePath);
    const cached = cacheByPath.get(cacheKey);
    if (cached?.fingerprint === fingerprint) {
      remember(cacheKey, cached);
      return cached.result;
    }

    const inFlightKey = `${cacheKey}\0${fingerprint}`;
    const existingVerification = inFlightByFingerprint.get(inFlightKey);
    if (existingVerification) return existingVerification;

    const verification = (async () => {
      const result = await verify(rootPath, relativePath);
      const fingerprintAfterVerification = await readFingerprint(rootPath, relativePath);
      if (fingerprintAfterVerification === fingerprint) {
        remember(cacheKey, { fingerprint, result });
      }
      return result;
    })().finally(() => {
      inFlightByFingerprint.delete(inFlightKey);
    });
    inFlightByFingerprint.set(inFlightKey, verification);
    return verification;
  };

  return { verify: verifyCached };
};

export const recordingIntegrityCache = createRecordingIntegrityCache();

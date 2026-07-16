import type { SessionRecordingIntegrity } from '@fantetic-terminal/contracts';

import type { RecordingIntegrityResult } from './session-recorder';

type RecordingIntegrityAnchor = {
  recording_chain_hash: string | null;
  recording_batch_count: number;
};

export const resolveSessionRecordingIntegrity = (
  anchor: RecordingIntegrityAnchor,
  fileIntegrity: RecordingIntegrityResult,
): SessionRecordingIntegrity => {
  const base = {
    eventCount: fileIntegrity.eventCount,
    batchCount: fileIntegrity.batchCount,
  };
  if (fileIntegrity.status === 'invalid') {
    return { status: 'invalid', ...base, reason: fileIntegrity.reason };
  }
  if (anchor.recording_chain_hash) {
    if (
      fileIntegrity.status !== 'valid'
      || fileIntegrity.finalHash !== anchor.recording_chain_hash
      || fileIntegrity.batchCount !== anchor.recording_batch_count
    ) {
      return { status: 'invalid', ...base, reason: 'index-mismatch' };
    }
    return { status: 'valid', ...base };
  }
  if (fileIntegrity.status === 'legacy') return { status: 'legacy', ...base };
  return { status: 'unanchored', ...base };
};

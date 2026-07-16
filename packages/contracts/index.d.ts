export type SessionRecordingProtocol = 'SSH' | 'TELNET' | 'RDP' | 'VNC';
export type SessionRecordingStatus = 'active' | 'completed' | 'incomplete' | 'failed';

export type SessionRecordingEvent =
  | { offsetMs: number; type: 'output' | 'input'; data: string }
  | { offsetMs: number; type: 'resize'; cols: number; rows: number }
  // Raw Guacamole instructions. These are encrypted protocol transcripts, not
  // browser-playable recordings; a future playback adapter must interpret them.
  | { offsetMs: number; type: 'guacamole-client' | 'guacamole-server'; data: string };

export interface SessionRecordingMetadata {
  id: string;
  user_id: number | null;
  username: string | null;
  connection_id: number;
  connection_name: string;
  protocol: SessionRecordingProtocol;
  started_at: number;
  ended_at: number | null;
  status: SessionRecordingStatus;
  relative_path: string;
  event_count: number;
  byte_count: number;
  recording_chain_hash: string | null;
  recording_batch_count: number;
}

export type SessionRecordingIntegrityStatus = 'valid' | 'legacy' | 'unanchored' | 'invalid';

export interface SessionRecordingIntegrity {
  status: SessionRecordingIntegrityStatus;
  eventCount: number;
  batchCount: number;
  reason?: 'corrupt-batch' | 'invalid-batch' | 'previous-hash-mismatch' | 'hash-mismatch' | 'index-mismatch';
}

export interface SessionRecordingPage {
  metadata: SessionRecordingMetadata;
  eventList: SessionRecordingEvent[];
  nextCursor: number | null;
  integrity: SessionRecordingIntegrity;
}

export interface SessionRecordingListQuery {
  query?: string;
  status?: SessionRecordingStatus;
  startedAfter?: number;
  startedBefore?: number;
  limit?: number;
  offset?: number;
}

export interface SessionRecordingListPage {
  itemList: SessionRecordingMetadata[];
  total: number;
  limit: number;
  offset: number;
}

export interface TerminalServerCapabilities {
  sshBinaryInput: boolean;
  sshBinaryOutput: boolean;
}

export type ApiErrorArgument = string | number | boolean | null;

/**
 * Stable HTTP error representation shared across the API boundary.
 * `code` is an i18n-neutral identifier; user-visible text is resolved by the client.
 */
export interface ApiErrorEnvelope {
  code: string;
  args: ApiErrorArgument[];
  requestId: string;
}

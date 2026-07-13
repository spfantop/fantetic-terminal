export type TerminalProtocol = 'SSH' | 'TELNET';
export type SessionRecordingStatus = 'active' | 'completed' | 'incomplete' | 'failed';

export type SessionRecordingEvent =
  | { offsetMs: number; type: 'output' | 'input'; data: string }
  | { offsetMs: number; type: 'resize'; cols: number; rows: number };

export interface SessionRecordingMetadata {
  id: string;
  user_id: number | null;
  username: string | null;
  connection_id: number;
  connection_name: string;
  protocol: TerminalProtocol;
  started_at: number;
  ended_at: number | null;
  status: SessionRecordingStatus;
  relative_path: string;
  event_count: number;
  byte_count: number;
}

export interface SessionRecordingPage {
  metadata: SessionRecordingMetadata;
  eventList: SessionRecordingEvent[];
  nextCursor: number | null;
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

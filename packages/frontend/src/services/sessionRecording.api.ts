import apiClient from '../utils/apiClient';

export interface SessionRecording {
  id: string;
  username: string | null;
  connection_name: string;
  protocol: 'SSH' | 'TELNET';
  started_at: number;
  ended_at: number | null;
  status: 'active' | 'completed' | 'incomplete' | 'failed';
  event_count: number;
  byte_count: number;
}

export type SessionRecordingEvent =
  | { offsetMs: number; type: 'output' | 'input'; data: string }
  | { offsetMs: number; type: 'resize'; cols: number; rows: number };

export interface SessionRecordingPage {
  metadata: SessionRecording;
  eventList: SessionRecordingEvent[];
  nextCursor: number | null;
}

export const sessionRecordingApi = {
  async list(): Promise<SessionRecording[]> {
    return (await apiClient.get<SessionRecording[]>('/session-recordings')).data;
  },
  async read(id: string, cursor = 0): Promise<SessionRecordingPage> {
    return (await apiClient.get<SessionRecordingPage>(`/session-recordings/${id}`, {
      params: { cursor, limit: 100 },
    })).data;
  },
};

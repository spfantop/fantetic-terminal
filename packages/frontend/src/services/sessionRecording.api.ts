import apiClient from '../utils/apiClient';
import type {
  SessionRecordingEvent,
  SessionRecordingMetadata,
  SessionRecordingPage,
} from '@fantetic-terminal/contracts';

export type SessionRecording = SessionRecordingMetadata;
export type { SessionRecordingEvent, SessionRecordingPage };

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

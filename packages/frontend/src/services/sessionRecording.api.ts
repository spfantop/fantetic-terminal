import apiClient from '../utils/apiClient';
import type {
  SessionRecordingEvent,
  SessionRecordingMetadata,
  SessionRecordingPage,
  SessionRecordingListPage,
  SessionRecordingListQuery,
} from '@fantetic-terminal/contracts';

export type SessionRecording = SessionRecordingMetadata;
export type { SessionRecordingEvent, SessionRecordingPage, SessionRecordingListPage, SessionRecordingListQuery };

export const sessionRecordingApi = {
  async list(query: SessionRecordingListQuery = {}): Promise<SessionRecordingListPage> {
    return (await apiClient.get<SessionRecordingListPage>('/session-recordings', { params: query })).data;
  },
  async read(id: string, cursor = 0): Promise<SessionRecordingPage> {
    return (await apiClient.get<SessionRecordingPage>(`/session-recordings/${id}`, {
      params: { cursor, limit: 100 },
    })).data;
  },
};

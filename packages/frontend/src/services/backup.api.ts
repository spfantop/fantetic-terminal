import apiClient from '../utils/apiClient';

export interface BackupManifest {
  formatVersion: 1;
  id: string;
  createdAt: string;
  schemaVersion: number;
  files: Array<{ path: string; size: number; sha256: string }>;
}

export const backupApi = {
  async readCount(): Promise<number> { return (await apiClient.get<{ total: number }>('/backups/count')).data.total; },
  async list(): Promise<BackupManifest[]> { return (await apiClient.get<BackupManifest[]>('/backups')).data; },
  async create(): Promise<BackupManifest> { return (await apiClient.post<BackupManifest>('/backups')).data; },
  async verify(backupId: string): Promise<{ valid: boolean; errors: string[] }> {
    return (await apiClient.post<{ valid: boolean; errors: string[] }>(`/backups/${backupId}/verify`)).data;
  },
  async scheduleRestore(backupId: string): Promise<void> { await apiClient.post(`/backups/${backupId}/restore`); },
};

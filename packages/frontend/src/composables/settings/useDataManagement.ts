import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '../../utils/apiClient';
import { isAxiosError } from 'axios';
import { useConnectionsStore } from '../../stores/connections.store';
import { useTagsStore } from '../../stores/tags.store';
import { useSshKeysStore } from '../../stores/sshKeys.store';

export interface ImportConnectionsResult {
  successCount: number;
  skippedCount: number;
  failureCount: number;
  importedSshKeyCount: number;
  skippedSshKeyCount: number;
  errors?: { connectionName?: string; message: string }[];
  warnings?: string[];
}

export function useDataManagement() {
  const { t } = useI18n();
  const connectionsStore = useConnectionsStore();
  const tagsStore = useTagsStore();
  const sshKeysStore = useSshKeysStore();

  // --- Export Connections State & Method ---
  const exportConnectionsLoading = ref(false);
  const exportConnectionsMessage = ref('');
  const exportConnectionsSuccess = ref(false);
  const importConnectionsLoading = ref(false);
  const importConnectionsMessage = ref('');
  const importConnectionsSuccess = ref(false);
  const importConnectionsResult = ref<ImportConnectionsResult | null>(null);

  const handleExportConnections = async () => {
    exportConnectionsLoading.value = true;
    exportConnectionsMessage.value = '';
    exportConnectionsSuccess.value = false;
    try {
      const response = await apiClient.get('/settings/export-connections', {
        responseType: 'blob',
      });

      let filename = 'fantetic_connections_export.zip';
      const disposition = response.headers['content-disposition'];
      if (disposition && disposition.includes('attachment')) {
        const filenameRegex = /filename[^;=\n]*=(?:(?:["'])(?<quoted>.*?)\1|(?<unquoted>[^;\n]*))/;
        const matches = filenameRegex.exec(disposition);
        if (matches?.groups?.quoted || matches?.groups?.unquoted) {
          filename = matches.groups.quoted || matches.groups.unquoted;
        }
      }

      const contentType = response.headers['content-type'];
      const blob = new Blob([response.data], { type: typeof contentType === 'string' ? contentType : 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      exportConnectionsMessage.value = t('settings.exportConnections.success', '导出成功。文件已开始下载。');
      exportConnectionsSuccess.value = true;
    } catch (error: any) {
      console.error('导出连接失败:', error);
      let message = t('settings.exportConnections.error', '导出连接时发生错误。');
      if (isAxiosError(error) && error.response && error.response.data) {
        if (error.response.data instanceof Blob && error.response.data.type === 'application/json') {
          try {
            const errorJson = JSON.parse(await error.response.data.text());
            message = errorJson.message || message;
          } catch (e) { /* Blob not valid JSON */ }
        } else if (typeof error.response.data === 'string' && error.response.data.length < 200) { // Avoid overly long string errors
          message = error.response.data;
        } else if (error.response.data && typeof error.response.data.message === 'string') {
          message = error.response.data.message;
        }
      } else if (error.message) {
        message = error.message;
      }
      exportConnectionsMessage.value = message;
      exportConnectionsSuccess.value = false;
    } finally {
      exportConnectionsLoading.value = false;
    }
  };

  const parseApiErrorMessage = async (error: any, fallback: string) => {
    let message = fallback;
    if (isAxiosError(error) && error.response && error.response.data) {
      if (error.response.data instanceof Blob && error.response.data.type === 'application/json') {
        try {
          const errorJson = JSON.parse(await error.response.data.text());
          message = errorJson.message || message;
        } catch (e) { /* Blob not valid JSON */ }
      } else if (typeof error.response.data === 'string' && error.response.data.length < 200) {
        message = error.response.data;
      } else if (error.response.data && typeof error.response.data.message === 'string') {
        message = error.response.data.message;
      }
    } else if (error.message) {
      message = error.message;
    }
    return message;
  };

  const handleImportConnections = async (file: File | null) => {
    if (!file) {
      importConnectionsMessage.value = t('settings.importConnections.selectFileFirst', '请先选择导出的 ZIP 文件。');
      importConnectionsSuccess.value = false;
      return;
    }

    importConnectionsLoading.value = true;
    importConnectionsMessage.value = '';
    importConnectionsSuccess.value = false;
    importConnectionsResult.value = null;
    try {
      const formData = new FormData();
      formData.append('connectionsZip', file);
      const response = await apiClient.post<ImportConnectionsResult>('/settings/import-connections', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      importConnectionsResult.value = response.data;
      importConnectionsSuccess.value = response.data.failureCount === 0;
      importConnectionsMessage.value = response.data.failureCount > 0
        ? t('settings.importConnections.partialSuccess', '导入完成，但有部分项目失败。')
        : t('settings.importConnections.success', '导入成功完成。');

      localStorage.removeItem('connectionsCache');
      localStorage.removeItem('tagsCache');
      await Promise.all([
        connectionsStore.fetchConnections(),
        connectionsStore.fetchFolders(),
        tagsStore.fetchTags(),
        sshKeysStore.fetchSshKeys(),
      ]);
    } catch (error: any) {
      console.error('导入连接失败:', error);
      importConnectionsMessage.value = await parseApiErrorMessage(error, t('settings.importConnections.error', '导入连接时发生错误。'));
      importConnectionsSuccess.value = false;
    } finally {
      importConnectionsLoading.value = false;
    }
  };

  return {
    exportConnectionsLoading,
    exportConnectionsMessage,
    exportConnectionsSuccess,
    handleExportConnections,
    importConnectionsLoading,
    importConnectionsMessage,
    importConnectionsSuccess,
    importConnectionsResult,
    handleImportConnections,
  };
}

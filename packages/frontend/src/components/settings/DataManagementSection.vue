<template>
  <div v-if="settings" class="p-4 bg-background text-foreground">
    <div class="max-w-6xl mx-auto">
      <h2 class="text-xl font-semibold text-foreground mb-4 pb-2 border-b border-border">
        {{ t('settings.category.dataManagement', '数据管理') }}
      </h2>
      <div class="space-y-6">
      <div v-if="isAdministrator" class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">{{ t('backup.title') }}</h3>
        <p class="text-sm text-text-secondary mb-4">{{ t('backup.description') }}</p>
        <div class="flex flex-wrap items-center gap-3 mb-4">
          <button type="button" :disabled="backupLoading" class="px-4 py-2 bg-button text-button-text rounded-md disabled:opacity-50" @click="createBackup">
            {{ backupLoading ? t('common.loading') : t('backup.create') }}
          </button>
          <button type="button" :disabled="backupLoading" class="px-4 py-2 border border-border rounded-md" @click="loadBackups">{{ t('common.refresh') }}</button>
          <span v-if="backupMessage" :class="backupError ? 'text-error' : 'text-success'">{{ backupMessage }}</span>
        </div>
        <div class="overflow-x-auto border border-border rounded-md">
          <table class="min-w-full text-sm"><thead class="bg-header"><tr><th class="p-3 text-left">{{ t('backup.createdAt') }}</th><th class="p-3 text-left">{{ t('backup.schemaVersion') }}</th><th class="p-3 text-left">{{ t('backup.fileCount') }}</th><th class="p-3 text-left">{{ t('common.actions') }}</th></tr></thead>
            <tbody><tr v-for="backup in backups" :key="backup.id" class="border-t border-border"><td class="p-3">{{ backup.createdAt }}</td><td class="p-3">{{ backup.schemaVersion }}</td><td class="p-3">{{ backup.files.length }}</td><td class="p-3 flex gap-2"><button type="button" class="px-3 py-1 border border-border rounded" @click="verifyBackup(backup.id)">{{ t('backup.verify') }}</button><button type="button" class="px-3 py-1 bg-error text-white rounded" @click="scheduleRestore(backup.id)">{{ t('backup.restore') }}</button></td></tr>
              <tr v-if="backups.length === 0"><td colspan="4" class="p-4 text-center text-text-secondary">{{ t('backup.empty') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <!-- Export Connections Section -->
      <div class="settings-section-content">
         <h3 class="text-base font-semibold text-foreground mb-3">{{ t('settings.exportConnections.title', '导出连接数据') }}</h3>
         <p class="text-sm text-text-secondary mb-4">
           <span class="font-semibold text-warning">{{ t('settings.exportConnections.decryptKeyInfo', '解压密码为您的 data/.env 文件中的 ENCRYPTION_KEY。请妥善保管此文件。') }}</span>
         </p>
         <form @submit.prevent="handleExportConnections" class="space-y-4">
           <div class="flex items-center justify-between">
              <button type="submit" :disabled="exportConnectionsLoading"
                      class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium inline-flex items-center">
                <svg v-if="exportConnectionsLoading" class="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {{ exportConnectionsLoading ? t('common.loading') : t('settings.exportConnections.buttonText', '开始导出') }}
              </button>
              <p v-if="exportConnectionsMessage" :class="['text-sm', exportConnectionsSuccess ? 'text-success' : 'text-error']">{{ exportConnectionsMessage }}</p>
           </div>
         </form>
      </div>
      <!-- Import Connections Section -->
      <div class="settings-section-content">
         <h3 class="text-base font-semibold text-foreground mb-3">{{ t('settings.importConnections.title', '导入连接数据') }}</h3>
         <p class="text-sm text-text-secondary mb-4">
           {{ t('settings.importConnections.description', '上传从本系统导出的加密 ZIP 文件，将自动按当前 ENCRYPTION_KEY 解压并导入连接、标签和 SSH 密钥。') }}
         </p>
         <form @submit.prevent="submitImportConnections" class="space-y-4">
           <div class="flex flex-wrap items-center gap-3">
              <input
                ref="importFileInputRef"
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                class="block max-w-md text-sm text-text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-button file:px-3 file:py-2 file:text-sm file:font-medium file:text-button-text hover:file:bg-button-hover"
                @change="handleImportFileChange"
              />
              <button type="submit" :disabled="importConnectionsLoading || !selectedImportFile"
                      class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium inline-flex items-center">
                <svg v-if="importConnectionsLoading" class="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {{ importConnectionsLoading ? t('common.loading') : t('settings.importConnections.buttonText', '开始导入') }}
              </button>
              <p v-if="importConnectionsMessage" :class="['text-sm', importConnectionsSuccess ? 'text-success' : 'text-error']">{{ importConnectionsMessage }}</p>
           </div>
           <div v-if="importConnectionsResult" class="rounded-md border border-border bg-background/60 p-3 text-sm text-text-secondary">
             <p>
               {{ t('settings.importConnections.summary', {
                 successCount: importConnectionsResult.successCount,
                 skippedCount: importConnectionsResult.skippedCount,
                 failureCount: importConnectionsResult.failureCount,
                 importedSshKeyCount: importConnectionsResult.importedSshKeyCount,
                 skippedSshKeyCount: importConnectionsResult.skippedSshKeyCount,
               }, `连接导入 ${importConnectionsResult.successCount} 条，跳过 ${importConnectionsResult.skippedCount} 条，失败 ${importConnectionsResult.failureCount} 条；SSH 密钥导入 ${importConnectionsResult.importedSshKeyCount} 个，跳过 ${importConnectionsResult.skippedSshKeyCount} 个。`) }}
             </p>
             <ul v-if="importConnectionsResult.errors?.length" class="mt-2 list-disc pl-5 text-error">
               <li v-for="(error, index) in importConnectionsResult.errors.slice(0, 5)" :key="index">
                 {{ error.connectionName ? `${error.connectionName}: ` : '' }}{{ error.message }}
               </li>
             </ul>
             <ul v-if="importConnectionsResult.warnings?.length" class="mt-2 list-disc pl-5 text-warning">
               <li v-for="(warning, index) in importConnectionsResult.warnings.slice(0, 5)" :key="index">
                 {{ warning }}
               </li>
             </ul>
           </div>
         </form>
      </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSettingsStore } from '../../stores/settings.store';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useDataManagement } from '../../composables/settings/useDataManagement';
import { useAuthStore } from '../../stores/auth.store';
import { backupApi, type BackupManifest } from '../../services/backup.api';

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);
const { t } = useI18n();
const authStore = useAuthStore();
const isAdministrator = computed(() => ['super_admin', 'admin'].includes(authStore.user?.systemRole ?? ''));
const backups = ref<BackupManifest[]>([]);
const backupLoading = ref(false);
const backupMessage = ref('');
const backupError = ref(false);
const selectedImportFile = ref<File | null>(null);
const importFileInputRef = ref<HTMLInputElement | null>(null);

const {
  exportConnectionsLoading,
  exportConnectionsMessage,
  exportConnectionsSuccess,
  handleExportConnections,
  importConnectionsLoading,
  importConnectionsMessage,
  importConnectionsSuccess,
  importConnectionsResult,
  handleImportConnections,
} = useDataManagement();

const handleImportFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  selectedImportFile.value = input.files?.[0] ?? null;
};

const submitImportConnections = async () => {
  await handleImportConnections(selectedImportFile.value);
  if (importConnectionsSuccess.value && importFileInputRef.value) {
    importFileInputRef.value.value = '';
    selectedImportFile.value = null;
  }
};

const loadBackups = async () => {
  if (!isAdministrator.value) return;
  backupLoading.value = true;
  try { backups.value = await backupApi.list(); backupError.value = false; }
  catch { backupError.value = true; backupMessage.value = t('backup.operationFailed'); }
  finally { backupLoading.value = false; }
};
const createBackup = async () => {
  backupLoading.value = true;
  try { await backupApi.create(); backupMessage.value = t('backup.created'); backupError.value = false; await loadBackups(); }
  catch { backupError.value = true; backupMessage.value = t('backup.operationFailed'); backupLoading.value = false; }
};
const verifyBackup = async (backupId: string) => {
  try {
    const result = await backupApi.verify(backupId);
    backupError.value = !result.valid;
    backupMessage.value = result.valid ? t('backup.valid') : t('backup.invalid', { errors: result.errors.join('; ') });
  } catch { backupError.value = true; backupMessage.value = t('backup.operationFailed'); }
};
const scheduleRestore = async (backupId: string) => {
  if (!window.confirm(t('backup.confirmRestore'))) return;
  try { await backupApi.scheduleRestore(backupId); backupError.value = false; backupMessage.value = t('backup.restoreScheduled'); }
  catch { backupError.value = true; backupMessage.value = t('backup.operationFailed'); }
};
onMounted(loadBackups);
</script>

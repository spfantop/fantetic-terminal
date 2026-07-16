import { getAppDataPath } from '../config/app-data-path';
import { backupDatabaseTo, readDatabaseSchemaVersion } from '../database/connection';

import { createBackupService } from './backup.service';

let backupService: ReturnType<typeof createBackupService> | null = null;

export const getBackupService = (): ReturnType<typeof createBackupService> => {
  if (!backupService) {
    backupService = createBackupService({
      appDataPath: getAppDataPath(),
      snapshotDatabase: backupDatabaseTo,
      readSchemaVersion: readDatabaseSchemaVersion,
    });
  }
  return backupService;
};

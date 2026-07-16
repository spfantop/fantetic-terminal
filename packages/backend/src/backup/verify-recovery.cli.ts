import path from 'node:path';

import { verifyBackupRecovery } from './recovery-verification';

const requireEnvironmentValue = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const main = async (): Promise<void> => {
  const appDataPath = requireEnvironmentValue('BACKUP_RECOVERY_DATA_PATH');
  const runtimeEnvPath = process.env.BACKUP_RECOVERY_RUNTIME_ENV_PATH?.trim() || path.join(appDataPath, '.env');
  const report = await verifyBackupRecovery({
    appDataPath,
    runtimeEnvPath,
    backupId: process.env.BACKUP_RECOVERY_BACKUP_ID?.trim() || undefined,
  });
  console.log(JSON.stringify(report));
};

main().catch(error => {
  console.error(error instanceof Error ? `[Backup recovery verification] ${error.message}` : '[Backup recovery verification] failed.');
  process.exitCode = 1;
});

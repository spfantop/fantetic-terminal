import path from 'node:path';

import type { BackupRetentionPolicy } from './backup.service';

export interface BackupScheduleConfig extends BackupRetentionPolicy {
  enabled: boolean;
  intervalMs: number;
}

type Environment = Record<string, string | undefined>;

const readEnabled = (value: string | undefined): boolean => {
  if (value === undefined || value.trim() === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('BACKUP_SCHEDULE_ENABLED must be true or false.');
};

const readInteger = (environment: Environment, key: string, fallback: number, minimum: number, maximum: number): number => {
  const value = environment[key];
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
};

export const resolveBackupScheduleConfig = (environment: Environment = process.env): BackupScheduleConfig => {
  const enabled = readEnabled(environment.BACKUP_SCHEDULE_ENABLED);
  const intervalMinutes = readInteger(environment, 'BACKUP_INTERVAL_MINUTES', 24 * 60, 15, 10_080);
  const retentionCount = readInteger(environment, 'BACKUP_RETENTION_COUNT', 14, 1, 365);
  const configuredArchivePath = environment.BACKUP_ARCHIVE_PATH?.trim();
  if (configuredArchivePath && !path.isAbsolute(configuredArchivePath)) {
    throw new Error('BACKUP_ARCHIVE_PATH must be absolute.');
  }
  return {
    enabled,
    intervalMs: intervalMinutes * 60 * 1000,
    retentionCount,
    ...(configuredArchivePath ? { archiveRootPath: configuredArchivePath } : {}),
  };
};

interface BackupPolicyExecutor {
  createBackupWithPolicy(policy: BackupRetentionPolicy): Promise<unknown>;
}

export const startBackupScheduler = ({
  config,
  backupService,
  setInterval = global.setInterval,
  clearInterval = global.clearInterval,
  logError = console.error,
}: {
  config: BackupScheduleConfig;
  backupService: BackupPolicyExecutor;
  setInterval?: typeof global.setInterval;
  clearInterval?: typeof global.clearInterval;
  logError?: (error: unknown) => void;
}) => {
  if (!config.enabled) {
    return { started: false, intervalMs: config.intervalMs, stop: async () => undefined };
  }
  let activeRun: Promise<void> | null = null;
  let stopped = false;
  const run = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (activeRun) return activeRun;
    activeRun = (async () => {
      try {
        await backupService.createBackupWithPolicy({
          retentionCount: config.retentionCount,
          ...(config.archiveRootPath ? { archiveRootPath: config.archiveRootPath } : {}),
        });
      } catch (error) {
        logError(error);
      } finally {
        activeRun = null;
      }
    })();
    return activeRun;
  };
  const timer = setInterval(() => { void run(); }, config.intervalMs);
  return {
    started: true,
    intervalMs: config.intervalMs,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await activeRun;
    },
  };
};

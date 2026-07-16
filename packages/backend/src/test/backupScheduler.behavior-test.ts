import assert from 'node:assert/strict';

const { resolveBackupScheduleConfig, startBackupScheduler } = await import('../backup/backup.scheduler');

assert.deepEqual(resolveBackupScheduleConfig({}), {
  enabled: false,
  intervalMs: 24 * 60 * 60 * 1000,
  retentionCount: 14,
});

const config = resolveBackupScheduleConfig({
  BACKUP_SCHEDULE_ENABLED: 'true',
  BACKUP_INTERVAL_MINUTES: '30',
  BACKUP_RETENTION_COUNT: '7',
  BACKUP_ARCHIVE_PATH: 'D:/backups/fantetic-terminal',
});
assert.deepEqual(config, {
  enabled: true,
  intervalMs: 30 * 60 * 1000,
  retentionCount: 7,
  archiveRootPath: 'D:/backups/fantetic-terminal',
});
assert.throws(() => resolveBackupScheduleConfig({ BACKUP_SCHEDULE_ENABLED: 'yes' }), /true or false/);
assert.throws(() => resolveBackupScheduleConfig({ BACKUP_SCHEDULE_ENABLED: 'true', BACKUP_INTERVAL_MINUTES: '5' }), /between 15 and 10080/);

let timerCallback: (() => void) | undefined;
let clearedTimer: unknown;
const submittedPolicies: unknown[] = [];
const scheduler = startBackupScheduler({
  config,
  backupService: {
    createBackupWithPolicy: async policy => { submittedPolicies.push(policy); },
  },
  setInterval: callback => {
    timerCallback = callback;
    return 'timer-id' as unknown as NodeJS.Timeout;
  },
  clearInterval: timer => { clearedTimer = timer; },
  logError: error => { throw error; },
});

assert.equal(scheduler.started, true);
assert.equal(scheduler.intervalMs, 30 * 60 * 1000);
timerCallback?.();
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(submittedPolicies, [{
  retentionCount: 7,
  archiveRootPath: 'D:/backups/fantetic-terminal',
}]);
scheduler.stop();
assert.equal(clearedTimer, 'timer-id');

console.log('backup scheduler behavior ok');

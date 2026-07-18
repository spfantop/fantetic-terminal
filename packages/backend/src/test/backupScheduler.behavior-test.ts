import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

const { resolveBackupScheduleConfig, startBackupScheduler } = await import('../backup/backup.scheduler');
const archiveRootPath = path.join(os.tmpdir(), 'fantetic-backups');

assert.deepEqual(resolveBackupScheduleConfig({}), {
  enabled: false,
  intervalMs: 24 * 60 * 60 * 1000,
  retentionCount: 14,
});

const config = resolveBackupScheduleConfig({
  BACKUP_SCHEDULE_ENABLED: 'true',
  BACKUP_INTERVAL_MINUTES: '30',
  BACKUP_RETENTION_COUNT: '7',
  BACKUP_ARCHIVE_PATH: archiveRootPath,
});
assert.deepEqual(config, {
  enabled: true,
  intervalMs: 30 * 60 * 1000,
  retentionCount: 7,
  archiveRootPath,
});
assert.throws(() => resolveBackupScheduleConfig({ BACKUP_SCHEDULE_ENABLED: 'yes' }), /true or false/);
assert.throws(() => resolveBackupScheduleConfig({ BACKUP_SCHEDULE_ENABLED: 'true', BACKUP_INTERVAL_MINUTES: '5' }), /between 15 and 10080/);
assert.throws(() => resolveBackupScheduleConfig({ BACKUP_ARCHIVE_PATH: 'backups/fantetic-terminal' }), /must be absolute/);

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
  archiveRootPath,
}]);
scheduler.stop();
assert.equal(clearedTimer, 'timer-id');
timerCallback?.();
await new Promise(resolve => setImmediate(resolve));
assert.equal(submittedPolicies.length, 1, 'a queued timer callback must not start a backup after stop');

let finishBackup!: () => void;
let backupStarted = false;
let drainingTimerCallback: (() => void) | undefined;
const drainingScheduler = startBackupScheduler({
  config,
  backupService: {
    createBackupWithPolicy: async () => {
      backupStarted = true;
      await new Promise<void>(resolve => { finishBackup = resolve; });
    },
  },
  setInterval: callback => {
    drainingTimerCallback = callback;
    return 'draining-timer' as unknown as NodeJS.Timeout;
  },
  clearInterval: () => undefined,
  logError: error => { throw error; },
});
drainingTimerCallback?.();
await Promise.resolve();
assert.equal(backupStarted, true);

let stopCompleted = false;
const stopPromise = Promise.resolve(drainingScheduler.stop()).then(() => {
  stopCompleted = true;
});
await Promise.resolve();
assert.equal(stopCompleted, false, 'scheduler stop must wait for an in-flight backup');
finishBackup();
await stopPromise;
assert.equal(stopCompleted, true);

console.log('backup scheduler behavior ok');

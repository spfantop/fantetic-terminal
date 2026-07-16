import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-session-recording-settings-'));
process.env.APP_BACKEND_DATA_PATH = tempDir;
process.env.ENCRYPTION_KEY = '33'.repeat(32);

const administrator = { runtime: 'web' as const, userId: 101, username: 'admin', systemRole: 'admin' as const };
const ordinaryUser = { runtime: 'web' as const, userId: 102, username: 'user', systemRole: 'user' as const };

const run = async () => {
  const { getDbInstance, runDb } = await import('../database/connection');
  const { settingsService } = await import('../settings/settings.service');
  const { startSessionRecording, finishSessionRecording } = await import('../session-recording/session-recording.service');
  let db: Awaited<ReturnType<typeof getDbInstance>> | undefined;
  try {
    db = await getDbInstance();
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (101, 'admin', 'x', 'admin', 'active')`);
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (102, 'user', 'x', 'user', 'active')`);

    const adminSettings = await settingsService.getAllSettings(administrator);
    assert.equal(adminSettings.sessionRecordingEnabled, 'true');
    assert.equal((await settingsService.getAllSettings(ordinaryUser)).sessionRecordingEnabled, undefined);

    await assert.rejects(
      () => settingsService.setMultipleSettings({ sessionRecordingEnabled: 'false' }, ordinaryUser),
      /系统管理员权限/,
    );

    await settingsService.setMultipleSettings({ sessionRecordingEnabled: 'false' }, administrator);
    assert.equal(await startSessionRecording({ connectionId: 1, connectionName: 'disabled', protocol: 'SSH' }), undefined);

    await settingsService.setMultipleSettings({ sessionRecordingEnabled: 'true' }, administrator);
    const recorder = await startSessionRecording({ connectionId: 1, connectionName: 'enabled', protocol: 'SSH' });
    assert.ok(recorder, 'opening the switch must restore recording for new sessions');
    await finishSessionRecording(recorder);
  } finally {
    if (db) await new Promise<void>((resolve, reject) => db!.close(error => error ? reject(error) : resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

run().then(() => console.log('session recording settings behavior ok')).catch(error => {
  console.error(error);
  process.exit(1);
});

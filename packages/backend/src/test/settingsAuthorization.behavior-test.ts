import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-settings-auth-'));
process.env.APP_BACKEND_DATA_PATH = tempDir;

const alice = { runtime: 'web' as const, userId: 101, username: 'alice', systemRole: 'user' as const };
const bob = { runtime: 'web' as const, userId: 102, username: 'bob', systemRole: 'admin' as const };

const run = async () => {
  const { getDbInstance, runDb } = await import('../database/connection');
  const { settingsService } = await import('../settings/settings.service');
  let db: Awaited<ReturnType<typeof getDbInstance>> | undefined;
  try {
    db = await getDbInstance();
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (101, 'alice', 'x', 'user', 'active')`);
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (102, 'bob', 'x', 'admin', 'active')`);

    const aliceSettings = await settingsService.getAllSettings(alice);
    assert.equal(aliceSettings.captchaConfig, undefined);
    assert.equal(aliceSettings.aiProviderConfig, undefined);
    assert.equal(aliceSettings.ipWhitelist, undefined);
    assert.equal(typeof aliceSettings.terminalHighlightRules, 'string');

    const adminSettings = await settingsService.getAllSettings(bob);
    assert.equal(adminSettings.captchaConfig, undefined, 'generic settings endpoint never returns embedded secrets');
    assert.equal(adminSettings.aiProviderConfig, undefined);
    assert.equal(typeof adminSettings.ipWhitelist, 'string');

    await settingsService.setMultipleSettings({ terminalHighlightEnabled: 'false' }, alice);
    assert.equal((await settingsService.getAllSettings(alice)).terminalHighlightEnabled, 'false');
    assert.equal((await settingsService.getAllSettings(bob)).terminalHighlightEnabled, 'true');
    await assert.rejects(
      () => settingsService.setMultipleSettings({ maxLoginAttempts: '99' }, alice),
      /系统管理员权限/,
    );
    assert.equal((await settingsService.getAllSettings(alice)).terminalHighlightEnabled, 'false');
    await assert.rejects(
      () => settingsService.setMultipleSettings({ terminalHighlightEnabled: false as unknown as string }, alice),
      /必须是字符串/,
    );
    await settingsService.setMultipleSettings({ maxLoginAttempts: '7' }, bob);
    assert.equal(await settingsService.getSetting('maxLoginAttempts'), '7');
  } finally {
    if (db) await new Promise<void>((resolve, reject) => db!.close(error => error ? reject(error) : resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

run().then(() => console.log('settings authorization behavior ok')).catch(error => {
  console.error(error);
  process.exit(1);
});

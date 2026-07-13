import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-appearance-'));
process.env.APP_BACKEND_DATA_PATH = tempDir;

const run = async () => {
  const { getDbInstance, runDb } = await import('../database/connection');
  const themes = await import('../terminal-themes/terminal-theme.repository');
  const appearance = await import('../appearance/appearance.repository');
  let db: Awaited<ReturnType<typeof getDbInstance>> | undefined;

  try {
    db = await getDbInstance();
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (101, 'alice', 'x', 'user', 'active')`);
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (102, 'bob', 'x', 'admin', 'active')`);
    const themeData = { foreground: '#ffffff', background: '#000000' };
    const aliceTheme = await themes.createTheme({ name: 'custom', themeData }, 101);
    const bobTheme = await themes.createTheme({ name: 'custom', themeData }, 102);
    assert.notEqual(aliceTheme._id, bobTheme._id);
    assert.equal(await themes.findThemeById(Number(bobTheme._id), 101), null);
    assert.equal(await themes.updateTheme(Number(bobTheme._id), { name: 'stolen', themeData }, 101), false);
    assert.equal(await themes.deleteTheme(Number(bobTheme._id), 101), false);
    assert.equal((await themes.findAllThemes(101)).some(theme => theme._id === bobTheme._id), false);

    await appearance.updateAppearanceSettings({ uiThemeMode: 'dark', activeTerminalThemeId: Number(aliceTheme._id) }, 101);
    await appearance.updateAppearanceSettings({ uiThemeMode: 'default', activeTerminalThemeId: Number(bobTheme._id) }, 102);
    assert.equal((await appearance.getAppearanceSettings(101)).uiThemeMode, 'dark');
    assert.equal((await appearance.getAppearanceSettings(102)).uiThemeMode, 'default');
    await assert.rejects(
      () => appearance.updateAppearanceSettings({ activeDarkTerminalThemeId: Number(bobTheme._id) }, 101),
      /无权使用/,
    );
  } finally {
    if (db) await new Promise<void>((resolve, reject) => db!.close(error => error ? reject(error) : resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

run().then(() => console.log('appearance ownership behavior ok')).catch(error => {
  console.error(error);
  process.exit(1);
});

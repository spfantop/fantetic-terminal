import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-custom-html-'));
process.env.APP_BACKEND_DATA_PATH = tempDir;

const run = async () => {
  const { getDbInstance, runDb } = await import('../database/connection');
  const appearance = await import('../appearance/appearance.service');
  let db: Awaited<ReturnType<typeof getDbInstance>> | undefined;

  try {
    db = await getDbInstance();
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (101, 'alice', 'x', 'user', 'active')`);
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (102, 'bob', 'x', 'admin', 'active')`);

    await appearance.createUserCustomHtmlTheme('shared-name.html', '<p>alice</p>', 101);
    await appearance.createUserCustomHtmlTheme('shared-name.html', '<p>bob</p>', 102);
    await appearance.createUserCustomHtmlTheme('bob-only.html', '<p>private</p>', 102);
    assert.equal(await appearance.getUserCustomHtmlThemeContent('shared-name.html', 101), '<p>alice</p>');
    assert.equal(await appearance.getUserCustomHtmlThemeContent('shared-name.html', 102), '<p>bob</p>');
    await assert.rejects(() => appearance.getUserCustomHtmlThemeContent('bob-only.html', 101), /未找到/);
    await assert.rejects(() => appearance.deleteUserCustomHtmlTheme('bob-only.html', 101), /未找到/);
    assert.equal(await appearance.getUserCustomHtmlThemeContent('bob-only.html', 102), '<p>private</p>');

    const aliceFiles = await fsp.readdir(path.join(tempDir, 'custom-html-themes', 'users', '101'));
    const bobFiles = await fsp.readdir(path.join(tempDir, 'custom-html-themes', 'users', '102'));
    assert.deepEqual(aliceFiles, ['shared-name.html']);
    assert.deepEqual(bobFiles.sort(), ['bob-only.html', 'shared-name.html']);
  } finally {
    if (db) await new Promise<void>((resolve, reject) => db!.close(error => error ? reject(error) : resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

run().then(() => console.log('custom html ownership behavior ok')).catch(error => {
  console.error(error);
  process.exit(1);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-private-history-'));
process.env.APP_BACKEND_DATA_PATH = tempDir;

const run = async () => {
  const { getDbInstance, runDb } = await import('../database/connection');
  const commands = await import('../command-history/command-history.repository');
  const paths = await import('../path-history/path-history.repository');
  const favorites = await import('../favorite-paths/favorite-paths.repository');
  let db: Awaited<ReturnType<typeof getDbInstance>> | undefined;

  try {
    db = await getDbInstance();
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (101, 'alice', 'x', 'user', 'active')`);
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (102, 'bob', 'x', 'admin', 'active')`);

    const aliceCommand = await commands.upsertCommand('cat /secret', 101);
    const bobCommand = await commands.upsertCommand('cat /secret', 102);
    assert.notEqual(aliceCommand, bobCommand);
    assert.deepEqual((await commands.getAllCommands(101)).map(item => item.id), [aliceCommand]);
    assert.equal(await commands.deleteCommandById(aliceCommand, 102), false, 'admin cannot read/delete another user private history');
    assert.equal(await commands.clearAllCommands(101), 1);
    assert.deepEqual((await commands.getAllCommands(102)).map(item => item.id), [bobCommand]);

    const alicePath = await paths.upsertPath('/srv/alice', 101);
    const bobPath = await paths.upsertPath('/srv/alice', 102);
    assert.notEqual(alicePath, bobPath);
    assert.equal(await paths.deletePathById(alicePath, 102), false);
    assert.equal(await paths.clearAllPaths(101), 1);
    assert.deepEqual((await paths.getAllPaths(102)).map(item => item.id), [bobPath]);

    const aliceFavorite = await favorites.addFavoritePath('private', '/srv/alice', 101);
    assert.equal(await favorites.findFavoritePathById(aliceFavorite, 102), undefined);
    assert.equal(await favorites.updateFavoritePath(aliceFavorite, 'stolen', '/srv/bob', 102), false);
    assert.equal(await favorites.updateFavoritePathLastUsedAt(aliceFavorite, 102), false);
    assert.equal(await favorites.deleteFavoritePath(aliceFavorite, 102), false);
    assert.equal((await favorites.getAllFavoritePaths('name', 101)).length, 1);
  } finally {
    if (db) await new Promise<void>((resolve, reject) => db!.close(error => error ? reject(error) : resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

run().then(() => console.log('private history ownership behavior ok')).catch(error => {
  console.error(error);
  process.exit(1);
});

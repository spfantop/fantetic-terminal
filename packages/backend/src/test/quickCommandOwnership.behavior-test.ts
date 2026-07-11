import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-quick-command-'));
process.env.APP_BACKEND_DATA_PATH = tempDir;

const run = async () => {
  const { getDbInstance, runDb } = await import('../database/connection');
  const commands = await import('../quick-commands/quick-commands.repository');
  const tags = await import('../quick-command-tags/quick-command-tag.repository');
  let db: Awaited<ReturnType<typeof getDbInstance>> | undefined;

  try {
    db = await getDbInstance();
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (101, 'alice', 'x', 'user', 'active')`);
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (102, 'bob', 'x', 'admin', 'active')`);

    const aliceCommand = await commands.addQuickCommand('deploy', 'deploy alice', 101);
    const bobCommand = await commands.addQuickCommand('deploy', 'deploy bob', 102);
    const aliceTag = await tags.createQuickCommandTag('production', 101);
    const bobTag = await tags.createQuickCommandTag('production', 102);
    assert.notEqual(aliceTag, bobTag, 'tag names are unique per user, not globally');

    assert.deepEqual((await commands.getAllQuickCommands('name', 101)).map(item => item.id), [aliceCommand]);
    assert.equal(await commands.findQuickCommandById(bobCommand, 101), undefined);
    assert.equal(await commands.updateQuickCommand(bobCommand, null, 'stolen', 101), false);
    assert.equal(await commands.incrementUsageCount(bobCommand, 101), false);
    assert.equal(await commands.deleteQuickCommand(bobCommand, 101), false);
    assert.equal(await tags.updateQuickCommandTag(bobTag, 'stolen', 101), false);
    assert.equal(await tags.deleteQuickCommandTag(bobTag, 101), false);

    await assert.rejects(() => tags.setCommandTagAssociations(aliceCommand, [bobTag], 101), /无权/);
    await assert.rejects(() => tags.addTagToCommands([bobCommand], aliceTag, 101), /无权/);
    await tags.setCommandTagAssociations(aliceCommand, [aliceTag], 101);
    assert.deepEqual((await commands.findQuickCommandById(aliceCommand, 101))?.tagIds, [aliceTag]);
  } finally {
    if (db) await new Promise<void>((resolve, reject) => db!.close(error => error ? reject(error) : resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

run().then(() => console.log('quick command ownership behavior ok')).catch(error => {
  console.error(error);
  process.exit(1);
});

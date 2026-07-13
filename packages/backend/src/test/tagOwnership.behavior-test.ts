import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-tag-ownership-'));
process.env.APP_BACKEND_DATA_PATH = tempDir;

const alice = { runtime: 'web' as const, userId: 101, username: 'alice', systemRole: 'user' as const };
const bob = { runtime: 'web' as const, userId: 102, username: 'bob', systemRole: 'user' as const };

const run = async () => {
  const { getDbInstance, runDb } = await import('../database/connection');
  const repository = await import('../tags/tag.repository');
  const service = await import('../tags/tag.service');
  let db: Awaited<ReturnType<typeof getDbInstance>> | undefined;

  try {
    db = await getDbInstance();
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (101, 'alice', 'x', 'user', 'active')`);
    await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (102, 'bob', 'x', 'user', 'active')`);
    await runDb(db, `INSERT INTO connections (id, name, host, port, username, auth_method, owner_user_id) VALUES (201, 'bob-host', '127.0.0.1', 22, 'root', 'password', 102)`);

    const aliceTagId = await repository.createTag('production', alice);
    const bobTagId = await repository.createTag('production', bob);
    assert.notEqual(aliceTagId, bobTagId, 'different users may use the same tag name');
    assert.deepEqual((await repository.findAllTags(alice)).map(tag => tag.id), [aliceTagId]);
    assert.equal(await repository.updateTag(bobTagId, 'stolen', alice), false);
    assert.equal(await repository.deleteTag(bobTagId, alice), false);

    await repository.updateTagConnections(bobTagId, [201], bob);
    await runDb(db, `INSERT INTO user_groups (id, name, created_by) VALUES (301, 'ops', 102)`);
    await runDb(db, `INSERT INTO user_group_members (group_id, user_id, role) VALUES (301, 101, 'viewer')`);
    await runDb(db, `INSERT INTO connection_group_permissions (connection_id, group_id, permission) VALUES (201, 301, 'view')`);

    assert.deepEqual(
      (await repository.findAllTags(alice)).map(tag => tag.id).sort((a, b) => a - b),
      [aliceTagId, bobTagId].sort((a, b) => a - b),
      'tags attached to readable shared connections remain visible',
    );
    assert.equal((await repository.findTagById(bobTagId, alice))?.name, 'production');
    await assert.rejects(
      () => service.updateTagConnections(aliceTagId, [201], alice),
      /required connection access|cannot manage|无权/i,
      'view-only group members cannot alter shared connection tags',
    );
  } finally {
    if (db) await new Promise<void>((resolve, reject) => db!.close(error => error ? reject(error) : resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

run().then(() => console.log('tag ownership behavior ok')).catch(error => {
  console.error(error);
  process.exit(1);
});

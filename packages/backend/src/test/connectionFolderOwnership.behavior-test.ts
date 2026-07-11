import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-folder-ownership-'));
process.env.APP_BACKEND_DATA_PATH = tempDir;

const alice = { runtime: 'web' as const, userId: 101, username: 'alice', systemRole: 'user' as const };
const bob = { runtime: 'web' as const, userId: 102, username: 'bob', systemRole: 'user' as const };

const run = async () => {
  const { getDbInstance, runDb } = await import('../database/connection');
  const repository = await import('../connections/connection.repository');
  let db: Awaited<ReturnType<typeof getDbInstance>> | undefined;

  try {
  db = await getDbInstance();
  await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (?, ?, ?, 'user', 'active')`, [101, 'alice', 'x']);
  await runDb(db, `INSERT INTO users (id, username, hashed_password, system_role, status) VALUES (?, ?, ?, 'user', 'active')`, [102, 'bob', 'x']);

  const aliceFolderId = await repository.createConnectionFolder('alice-folder', null, alice);
  const bobFolderId = await repository.createConnectionFolder('bob-folder', null, bob);

  assert.deepEqual((await repository.findAllConnectionFolders(alice)).map(folder => folder.id), [aliceFolderId]);
  assert.equal(await repository.updateConnectionFolder(bobFolderId, 'stolen', alice), false);
  assert.equal(await repository.deleteConnectionFolder(bobFolderId, alice), false);
  await repository.updateConnectionFoldersOrder([{ id: bobFolderId, parent_id: null, sort_order: 99 }], alice);
  assert.equal((await repository.findAllConnectionFolders(bob))[0].sort_order, 0);
  } finally {
    if (db) {
      await new Promise<void>((resolve, reject) => db!.close(error => error ? reject(error) : resolve()));
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('connection folder ownership behavior ok');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

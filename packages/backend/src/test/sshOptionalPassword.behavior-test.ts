import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-optional-password-'));
process.env.APP_BACKEND_DATA_PATH = directory;
process.env.ENCRYPTION_KEY = '12'.repeat(32);
async function run() {
  const { getDbInstance, withTransaction } = await import('../database/connection');
  const service = await import('../connections/connection.service');
  const repository = await import('../connections/connection.repository');
  const db = await getDbInstance();
  try {
    const connection = await service.createConnection({ name: 'Interactive', type: 'SSH', host: '127.0.0.1', port: 22, username: 'test', auth_method: 'password' });
    assert.equal((await repository.findFullConnectionById(connection.id))?.encrypted_password, null);
    await service.updateConnection(connection.id, { password: 'a*b' });
    assert.ok((await repository.findFullConnectionById(connection.id))?.encrypted_password);
    await service.updateConnection(connection.id, { password: '' });
    assert.equal((await repository.findFullConnectionById(connection.id))?.encrypted_password, null);
    await assert.rejects(service.createConnection({ name: 'RDP', type: 'RDP', host: '127.0.0.1', port: 3389, username: 'test', auth_method: 'password' }), /password/);
  } finally {
    // Service audit writes use the same serialized transaction queue.
    await withTransaction(db, async () => undefined);
    await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log('SSH optional stored password behavior passed');
}
void run();

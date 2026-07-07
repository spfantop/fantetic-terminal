import assert from 'node:assert/strict';
import archiver from 'archiver';
import { readEncryptedZipEntries } from '../services/encrypted-zip-reader';
import { parseConnectionImportScript } from '../services/connection-import-script';

archiver.registerFormat('zip-encrypted', require('archiver-zip-encrypted'));

const createEncryptedZip = async (password: string): Promise<Buffer> => new Promise((resolve, reject) => {
  const archive = archiver.create('zip-encrypted' as archiver.Format, {
    zlib: { level: 9 },
    encryptionMethod: 'aes256',
    password,
  } as archiver.ArchiverOptions & { encryptionMethod: string; password: string });
  const chunks: Buffer[] = [];

  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  archive.on('error', reject);
  archive.on('end', () => resolve(Buffer.concat(chunks)));

  archive.append('root@127.0.0.1:22 -type SSH -name 本地测试 -p "pa ss" -tags 运维 测试 -note "导入备注"', {
    name: 'connections.txt',
  });
  archive.append('-----BEGIN TEST KEY-----\nabc\n-----END TEST KEY-----', {
    name: 'ssh_keys/demo-key.txt',
  });
  archive.finalize().catch(reject);
});

const run = async () => {
  const password = 'connection-import-secret';
  const encryptedZip = await createEncryptedZip(password);
  const entries = readEncryptedZipEntries(encryptedZip, password);

  assert.equal(
    entries.get('connections.txt')?.toString('utf8'),
    'root@127.0.0.1:22 -type SSH -name 本地测试 -p "pa ss" -tags 运维 测试 -note "导入备注"',
    'encrypted export ZIP should decrypt connections.txt',
  );

  assert.equal(
    entries.get('ssh_keys/demo-key.txt')?.toString('utf8'),
    '-----BEGIN TEST KEY-----\nabc\n-----END TEST KEY-----',
    'encrypted export ZIP should decrypt SSH key files',
  );

  assert.throws(
    () => readEncryptedZipEntries(encryptedZip, 'wrong-password'),
    /密码|password|校验/i,
    'wrong ZIP password should be rejected',
  );

  const parsed = parseConnectionImportScript(entries.get('connections.txt')!.toString('utf8'));
  assert.deepEqual(parsed.connections, [
    {
      lineNumber: 1,
      type: 'SSH',
      name: '本地测试',
      host: '127.0.0.1',
      port: 22,
      username: 'root',
      auth_method: 'password',
      password: 'pa ss',
      tags: ['运维', '测试'],
      notes: '导入备注',
    },
  ]);
  assert.deepEqual(parsed.errors, []);

  console.log('connection import behavior ok');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

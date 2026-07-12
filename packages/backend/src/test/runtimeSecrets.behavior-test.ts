import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { persistRuntimeSecrets, resolveRuntimeSecrets, updateEnvDocument } from '../config/runtime-secrets';

assert.throws(() => resolveRuntimeSecrets({
  nodeEnv: 'production', appMode: 'web', encryptionKey: undefined, sessionSecret: undefined,
}), /ENCRYPTION_KEY.*SESSION_SECRET/);

const generated = resolveRuntimeSecrets({
  nodeEnv: 'production', appMode: 'electron', encryptionKey: undefined, sessionSecret: undefined,
  randomHex: (bytes) => 'a'.repeat(bytes * 2),
});
assert.equal(generated.encryptionKey.length, 64);
assert.equal(generated.sessionSecret.length, 128);
assert.equal(generated.generated, true);

assert.throws(() => resolveRuntimeSecrets({
  nodeEnv: 'production', appMode: 'web', encryptionKey: 'short', sessionSecret: 'also-short',
}), /ENCRYPTION_KEY/);

const updated = updateEnvDocument(
  '# existing\nENCRYPTION_KEY=old\nOTHER=value\nENCRYPTION_KEY=duplicate\n',
  { ENCRYPTION_KEY: 'new-key', SESSION_SECRET: 'new-secret' },
);
assert.equal((updated.match(/^ENCRYPTION_KEY=/gm) ?? []).length, 1);
assert.equal((updated.match(/^SESSION_SECRET=/gm) ?? []).length, 1);
assert.match(updated, /^OTHER=value$/m);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-runtime-secrets-'));
try {
  const envPath = path.join(temporaryDirectory, '.env');
  fs.writeFileSync(envPath, 'OTHER=value\nSESSION_SECRET=old\n');
  persistRuntimeSecrets(envPath, { SESSION_SECRET: 'replacement' });
  assert.equal(fs.readFileSync(envPath, 'utf8'), 'OTHER=value\nSESSION_SECRET=replacement\n');
  assert.equal(fs.readdirSync(temporaryDirectory).some(name => name.endsWith('.tmp')), false);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

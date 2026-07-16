import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';

import { AuditLogRepository, createAuditSearchPlan } from '../audit/audit.repository';

assert.deepEqual(createAuditSearchPlan('deployment 2026'), {
  kind: 'fts',
  matchExpression: 'deployment* AND 2026*',
});
assert.deepEqual(createAuditSearchPlan('登录失败'), {
  kind: 'like',
  value: '%登录失败%',
});
assert.equal(createAuditSearchPlan('   '), undefined);

const db = new sqlite3.Database(':memory:');
const exec = (sql: string) => new Promise<void>((resolve, reject) => {
  db.exec(sql, error => error ? reject(error) : resolve());
});
await exec(`
  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY, timestamp INTEGER, action_type TEXT, details TEXT,
    request_id TEXT, actor_user_id INTEGER, actor_username TEXT, actor_role TEXT,
    source_ip TEXT, asset_id INTEGER, session_id TEXT, result TEXT
  );
  CREATE VIRTUAL TABLE audit_logs_fts USING fts5(
    details, actor_username, source_ip, request_id, session_id,
    content='audit_logs', content_rowid='id'
  );
  INSERT INTO audit_logs VALUES
    (1, 1, 'DEPLOY', 'deployment completed', NULL, NULL, 'admin', NULL, NULL, NULL, NULL, 'success'),
    (2, 2, 'LOGIN', '登录失败', NULL, NULL, '管理员', NULL, NULL, NULL, NULL, 'failure');
  INSERT INTO audit_logs_fts(rowid, details, actor_username, source_ip, request_id, session_id)
    SELECT id, details, actor_username, source_ip, request_id, session_id FROM audit_logs;
`);
const repository = new AuditLogRepository({ getDatabase: async () => db });
const fullTextResult = await repository.getLogs(20, 0, undefined, undefined, undefined, 'deploy');
assert.equal(fullTextResult.total, 1);
assert.equal(fullTextResult.logs[0].id, 1);
const fallbackResult = await repository.getLogs(20, 0, undefined, undefined, undefined, '登录失败');
assert.equal(fallbackResult.total, 1);
assert.equal(fallbackResult.logs[0].id, 2);
await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve()));

console.log('audit search behavior passed');

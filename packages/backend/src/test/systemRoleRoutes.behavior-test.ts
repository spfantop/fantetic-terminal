import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { requireAuditReader } from '../access-control/audit-reader.middleware';
import { requireSystemAdministrator } from '../access-control/system-administrator.middleware';

const src = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), 'src', relativePath), 'utf8');

const auditRoutes = src('audit/audit.routes.ts');
const notificationRoutes = src('notifications/notification.routes.ts');

assert.match(auditRoutes, /requireAuditReader/);
assert.match(auditRoutes, /router\.use\(isAuthenticated, requireAuditReader\)/);
assert.match(notificationRoutes, /requireSystemAdministrator/);
assert.match(notificationRoutes, /router\.use\(isAuthenticated, requireSystemAdministrator\)/);

const run = (middleware: typeof requireAuditReader, authorization: Record<string, unknown>) => {
  let status: number | null = null;
  let nextCalled = false;
  middleware(
    { authorization } as never,
    {
      status(code: number) { status = code; return this; },
      json() { return this; },
    } as never,
    (() => { nextCalled = true; }) as never,
  );
  return { status, nextCalled };
};

assert.equal(run(requireAuditReader, { runtime: 'web', systemRole: 'user' }).status, 403);
assert.equal(run(requireAuditReader, { runtime: 'web', systemRole: 'auditor' }).nextCalled, true);
assert.equal(run(requireAuditReader, { runtime: 'desktop', systemRole: 'user' }).nextCalled, true);
assert.equal(run(requireSystemAdministrator, { runtime: 'web', systemRole: 'auditor' }).status, 403);
assert.equal(run(requireSystemAdministrator, { runtime: 'web', systemRole: 'admin' }).nextCalled, true);

console.log('system role route protection ok');

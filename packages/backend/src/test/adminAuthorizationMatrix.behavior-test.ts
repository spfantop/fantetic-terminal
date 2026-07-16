import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import session from 'express-session';

const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-admin-http-'));
const originalAppDataPath = process.env.APP_BACKEND_DATA_PATH;
const originalAppMode = process.env.FANTETIC_APP_MODE;
let testServer: http.Server | null = null;
let closeDatabase: (() => Promise<void>) | null = null;

process.env.APP_BACKEND_DATA_PATH = appDataPath;
process.env.FANTETIC_APP_MODE = 'web';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  actorUserId: number;
  body?: unknown;
};

const closeServer = (server: http.Server): Promise<void> => new Promise((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve());
});

const run = async (): Promise<void> => {
  try {
  const [
    { closeDbInstance, getDbInstance, runDb },
    { default: accessControlRouter },
    { default: auditRouter },
    { default: connectionsRouter },
    { AccessControlApplication },
    { accessControlRepository },
  ] = await Promise.all([
    import('../database/connection'),
    import('../access-control/access-control.routes'),
    import('../audit/audit.routes'),
    import('../connections/connections.routes'),
    import('../access-control/access-control.application'),
    import('../access-control/access-control.repository'),
  ]);
  closeDatabase = closeDbInstance;

  const database = await getDbInstance();
  await runDb(database, `
    INSERT INTO users (id, username, hashed_password, system_role, status, auth_epoch)
    VALUES
      (1, 'root', 'x', 'super_admin', 'active', 0),
      (2, 'ordinary-user', 'x', 'user', 'active', 0),
      (3, 'auditor-user', 'x', 'auditor', 'active', 0)
  `);
  const connection = await runDb(database, `
    INSERT INTO connections (name, type, host, port, username, auth_method, owner_user_id)
    VALUES ('protected-host', 'SSH', '127.0.0.1', 22, 'root', 'password', 1)
  `);

  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'admin-authorization-matrix', resave: false, saveUninitialized: true }));
  // The harness sets a server-side session identity after the real session middleware.
  // Authorization still passes through the production isAuthenticated middleware and SQLite repository.
  app.use((request, _response, next) => {
    const actorUserId = Number(request.get('x-test-actor-user-id'));
    if (Number.isInteger(actorUserId) && actorUserId > 0) {
      const testSession = request.session as typeof request.session & {
        userId?: number;
        username?: string;
        authEpoch?: number;
      };
      testSession.userId = actorUserId;
      testSession.username = `actor-${actorUserId}`;
      testSession.authEpoch = 0;
    }
    next();
  });
  app.use('/api/v1/access-control', accessControlRouter);
  app.use('/api/v1/audit-logs', auditRouter);
  app.use('/api/v1/connections', connectionsRouter);

  const server = http.createServer(app);
  testServer = server;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;

  const request = async (pathname: string, options: RequestOptions) => {
    const response = await fetch(`${origin}${pathname}`, {
      method: options.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        'x-test-actor-user-id': String(options.actorUserId),
      },
      ...(typeof options.body === 'undefined' ? {} : { body: JSON.stringify(options.body) }),
    });
    return {
      status: response.status,
      body: response.status === 204 ? undefined : await response.json(),
    };
  };

  const adminCreation = await request('/api/v1/access-control/users', {
    method: 'POST',
    actorUserId: 1,
    body: { username: 'workflow-admin', password: 'Administrator-password-1', systemRole: 'admin' },
  });
  assert.equal(adminCreation.status, 201);
  const administratorId = (adminCreation.body as { id: number }).id;

  const userCreation = await request('/api/v1/access-control/users', {
    method: 'POST',
    actorUserId: administratorId,
    body: { username: 'workflow-user', password: 'Workflow-password-1', systemRole: 'user' },
  });
  assert.equal(userCreation.status, 201);
  const workflowUserId = (userCreation.body as { id: number }).id;

  const groupCreation = await request('/api/v1/access-control/groups', {
    method: 'POST',
    actorUserId: administratorId,
    body: { name: 'workflow-operators', description: 'E2E authorization workflow' },
  });
  assert.equal(groupCreation.status, 201);
  const groupId = (groupCreation.body as { id: number }).id;

  const membership = await request(`/api/v1/access-control/groups/${groupId}/members/${workflowUserId}`, {
    method: 'PUT', actorUserId: administratorId, body: { role: 'operator' },
  });
  assert.equal(membership.status, 200);

  const grant = await request(`/api/v1/access-control/connections/${connection.lastID}/groups/${groupId}`, {
    method: 'PUT', actorUserId: administratorId, body: { permission: 'connect' },
  });
  assert.equal(grant.status, 200);

  const grantedConnectionRead = await request(`/api/v1/connections/${connection.lastID}`, {
    actorUserId: workflowUserId,
  });
  assert.equal(grantedConnectionRead.status, 200);

  const ordinaryGroupCreation = await request('/api/v1/access-control/groups', {
    method: 'POST', actorUserId: 2, body: { name: 'forbidden-group' },
  });
  assert.equal(ordinaryGroupCreation.status, 403);
  const ordinaryUserCreation = await request('/api/v1/access-control/users', {
    method: 'POST', actorUserId: 2,
    body: { username: 'forbidden-user', password: 'Forbidden-password-1', systemRole: 'user' },
  });
  assert.equal(ordinaryUserCreation.status, 403);

  const auditorGroupCreation = await request('/api/v1/access-control/groups', {
    method: 'POST', actorUserId: 3, body: { name: 'auditor-forbidden-group' },
  });
  assert.equal(auditorGroupCreation.status, 403);
  const auditorUserDisable = await request(`/api/v1/access-control/users/${workflowUserId}`, {
    method: 'PATCH', actorUserId: 3, body: { status: 'disabled' },
  });
  assert.equal(auditorUserDisable.status, 403);
  const auditorAuditRead = await request('/api/v1/audit-logs', { actorUserId: 3 });
  assert.equal(auditorAuditRead.status, 200);

  // SSH/Telnet WebSocket handlers delegate their admission decision to this same
  // application method. Exercise it against the real SQLite grants without opening a network connection.
  const accessControlApplication = new AccessControlApplication(accessControlRepository);
  await assert.rejects(
    accessControlApplication.requireConnectionPermission({
      runtime: 'web', userId: 2, username: 'ordinary-user', systemRole: 'user',
    }, connection.lastID, 'connect'),
    /required connection access/i,
  );
  await assert.rejects(
    accessControlApplication.requireConnectionPermission({
      runtime: 'web', userId: 3, username: 'auditor-user', systemRole: 'auditor',
    }, connection.lastID, 'connect'),
    /required connection access/i,
  );

  const disable = await request(`/api/v1/access-control/users/${workflowUserId}`, {
    method: 'PATCH', actorUserId: administratorId, body: { status: 'disabled' },
  });
  assert.equal(disable.status, 200);
  const disabledUserRead = await request(`/api/v1/connections/${connection.lastID}`, {
    actorUserId: workflowUserId,
  });
  assert.equal(disabledUserRead.status, 401);

  await closeServer(server);
  testServer = null;
  await closeDbInstance();
  closeDatabase = null;
  } finally {
    if (testServer) await closeServer(testServer).catch(() => undefined);
    if (closeDatabase) await closeDatabase().catch(() => undefined);
    if (typeof originalAppDataPath === 'undefined') delete process.env.APP_BACKEND_DATA_PATH;
    else process.env.APP_BACKEND_DATA_PATH = originalAppDataPath;
    if (typeof originalAppMode === 'undefined') delete process.env.FANTETIC_APP_MODE;
    else process.env.FANTETIC_APP_MODE = originalAppMode;
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
};

run().then(() => {
  console.log('admin authorization HTTP and WebSocket matrix behavior passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

import type { AuthorizationSubject } from '../access-control/authorization-subject';

export interface AuditContext {
  requestId: string;
  sourceIp: string;
  actorUserId?: number;
  actorUsername?: string;
  actorRole?: AuthorizationSubject['systemRole'];
}

const storage = new AsyncLocalStorage<AuditContext>();

export const runWithAuditContext = <T>(context: AuditContext, callback: () => T): T => storage.run(context, callback);
export const readAuditContext = (): AuditContext | undefined => storage.getStore();

export const setAuditActor = (subject: Pick<AuthorizationSubject, 'userId' | 'username' | 'systemRole'>): void => {
  const context = storage.getStore();
  if (!context) return;
  context.actorUserId = subject.userId;
  context.actorUsername = subject.username;
  context.actorRole = subject.systemRole;
};

const readRequestId = (req: Request): string => {
  const candidate = req.get('x-request-id')?.trim();
  return candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
};

export const auditContextMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const requestId = readRequestId(req);
  res.setHeader('X-Request-Id', requestId);
  runWithAuditContext({ requestId, sourceIp: req.ip || req.socket.remoteAddress || 'unknown' }, next);
};

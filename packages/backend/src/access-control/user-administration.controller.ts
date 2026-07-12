import bcrypt from 'bcrypt';
import { Request, Response } from 'express';

import { SystemRole } from './access-policy';
import { UserAdministrationApplication } from './user-administration.application';
import { userAdministrationRepository } from './user-administration.repository';
import { AuditLogService } from '../audit/audit.service';
import { deleteUserCustomHtmlThemes } from '../appearance/appearance.service';

const application = new UserAdministrationApplication(
  userAdministrationRepository,
  (password) => bcrypt.hash(password, 12),
);
const auditLogService = new AuditLogService();
const SYSTEM_ROLE_SET = new Set<SystemRole>(['super_admin', 'admin', 'user', 'auditor']);
const STATUS_SET = new Set(['active', 'disabled'] as const);

const handleError = (error: unknown, res: Response): void => {
  const message = error instanceof Error ? error.message : '';
  if (/required|cannot/i.test(message)) { res.status(403).json({ code: 'userAdministration.forbidden' }); return; }
  if (/not found/i.test(message)) { res.status(404).json({ code: 'userAdministration.notFound' }); return; }
  if (/UNIQUE constraint/i.test(message)) { res.status(409).json({ code: 'userAdministration.usernameExists' }); return; }
  res.status(400).json({ code: 'userAdministration.invalidRequest' });
};

export const listUsers = async (req: Request, res: Response): Promise<void> => {
  try { res.json(await application.listUsers(req.authorization!)); }
  catch (error) { handleError(error, res); }
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
  const systemRole = req.body.systemRole as SystemRole;
  if (!SYSTEM_ROLE_SET.has(systemRole)) {
    res.status(400).json({ code: 'userAdministration.invalidRole' }); return;
  }
  try {
    const user = await application.createUser(req.authorization!, {
      username: typeof req.body.username === 'string' ? req.body.username : '',
      password: typeof req.body.password === 'string' ? req.body.password : '',
      systemRole,
    });
    res.status(201).json(user);
  } catch (error) { handleError(error, res); }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
  const userId = Number(req.params.userId);
  const systemRole = req.body.systemRole as SystemRole | undefined;
  const status = req.body.status as 'active' | 'disabled' | undefined;
  if (!Number.isInteger(userId) || userId <= 0
    || (systemRole && !SYSTEM_ROLE_SET.has(systemRole))
    || (status && !STATUS_SET.has(status))) {
    res.status(400).json({ code: 'userAdministration.invalidRequest' }); return;
  }
  try { res.json(await application.updateUser(req.authorization!, userId, { systemRole, status })); }
  catch (error) { handleError(error, res); }
};

export const resetUserPassword = async (req: Request, res: Response): Promise<void> => {
  const userId = Number(req.params.userId);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ code: 'userAdministration.invalidRequest' }); return;
  }
  try {
    await application.resetPassword(req.authorization!, userId, password);
    await auditLogService.logAction('USER_PASSWORD_RESET', {
      actorUserId: req.authorization!.userId,
      targetUserId: userId,
    });
    res.status(204).send();
  } catch (error) { handleError(error, res); }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  const userId = Number(req.params.userId);
  const transferToUserId = Number(req.query.transferToUserId ?? req.body?.transferToUserId);
  if (!Number.isInteger(userId) || userId <= 0
    || !Number.isInteger(transferToUserId) || transferToUserId <= 0) {
    res.status(400).json({ code: 'userAdministration.invalidRequest' }); return;
  }
  try {
    await application.deleteUser(req.authorization!, userId, transferToUserId);
    try {
      await deleteUserCustomHtmlThemes(userId);
    } catch (error) {
      console.error(`[UserAdministration] 清理用户 ${userId} 的自定义 HTML 主题失败:`, error);
    }
    await auditLogService.logAction('USER_DELETED', {
      actorUserId: req.authorization!.userId,
      targetUserId: userId,
      transferToUserId,
    });
    res.status(204).send();
  } catch (error) { handleError(error, res); }
};

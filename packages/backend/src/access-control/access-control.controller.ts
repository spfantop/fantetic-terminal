import { Request, Response } from 'express';

import { AccessControlApplication } from './access-control.application';
import { accessControlRepository } from './access-control.repository';
import { GroupRole } from './access-policy';
import { AuditLogService } from '../audit/audit.service';

const application = new AccessControlApplication(accessControlRepository);
const auditLogService = new AuditLogService();
const GROUP_ROLE_SET = new Set<GroupRole>(['owner', 'admin', 'operator', 'viewer']);
const CONNECTION_PERMISSION_SET = new Set(['view', 'connect', 'manage'] as const);

const readPositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const handleError = (error: unknown, res: Response): void => {
  const message = error instanceof Error ? error.message : '';
  if (/required|cannot|current user/i.test(message)) {
    res.status(403).json({ code: 'accessControl.forbidden' });
    return;
  }
  if (/not found/i.test(message)) {
    res.status(404).json({ code: 'accessControl.notFound' });
    return;
  }
  res.status(400).json({ code: 'accessControl.invalidRequest' });
};

export const listGroups = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await application.listGroups(req.authorization!));
  } catch (error) { handleError(error, res); }
};

export const createGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const group = await application.createGroup(req.authorization!, {
      name: typeof req.body.name === 'string' ? req.body.name : '',
      description: typeof req.body.description === 'string' ? req.body.description : undefined,
    });
    await auditLogService.logAction('GROUP_CREATED', { groupId: group.id, name: group.name });
    res.status(201).json(group);
  } catch (error) { handleError(error, res); }
};

export const updateGroup = async (req: Request, res: Response): Promise<void> => {
  const groupId = readPositiveInteger(req.params.groupId);
  if (!groupId) { res.status(400).json({ code: 'accessControl.invalidGroupId' }); return; }
  try {
    const group = await application.updateGroup(req.authorization!, groupId, {
      name: typeof req.body.name === 'string' ? req.body.name : '',
      description: typeof req.body.description === 'string' ? req.body.description : undefined,
    });
    await auditLogService.logAction('GROUP_UPDATED', { groupId, name: group.name });
    res.json(group);
  } catch (error) { handleError(error, res); }
};

export const deleteGroup = async (req: Request, res: Response): Promise<void> => {
  const groupId = readPositiveInteger(req.params.groupId);
  if (!groupId) { res.status(400).json({ code: 'accessControl.invalidGroupId' }); return; }
  try {
    await application.deleteGroup(req.authorization!, groupId);
    await auditLogService.logAction('GROUP_DELETED', { groupId });
    res.status(204).send();
  } catch (error) { handleError(error, res); }
};

export const listMembers = async (req: Request, res: Response): Promise<void> => {
  const groupId = readPositiveInteger(req.params.groupId);
  if (!groupId) { res.status(400).json({ code: 'accessControl.invalidGroupId' }); return; }
  try {
    res.json(await application.listMembers(req.authorization!, groupId));
  } catch (error) { handleError(error, res); }
};

export const saveMember = async (req: Request, res: Response): Promise<void> => {
  const groupId = readPositiveInteger(req.params.groupId);
  const userId = readPositiveInteger(req.params.userId);
  const role = req.body.role as GroupRole;
  if (!groupId || !userId || !GROUP_ROLE_SET.has(role)) {
    res.status(400).json({ code: 'accessControl.invalidMembership' });
    return;
  }
  try {
    const member = await application.saveMember(req.authorization!, groupId, { userId, role });
    await auditLogService.logAction('GROUP_MEMBER_SAVED', { groupId, targetUserId: userId, role });
    res.json(member);
  } catch (error) { handleError(error, res); }
};

export const deleteMember = async (req: Request, res: Response): Promise<void> => {
  const groupId = readPositiveInteger(req.params.groupId);
  const userId = readPositiveInteger(req.params.userId);
  if (!groupId || !userId) { res.status(400).json({ code: 'accessControl.invalidMembership' }); return; }
  try {
    await application.deleteMember(req.authorization!, groupId, userId);
    await auditLogService.logAction('GROUP_MEMBER_DELETED', { groupId, targetUserId: userId });
    res.status(204).send();
  } catch (error) { handleError(error, res); }
};

export const listConnectionGrants = async (req: Request, res: Response): Promise<void> => {
  const connectionId = readPositiveInteger(req.params.connectionId);
  if (!connectionId) { res.status(400).json({ code: 'accessControl.invalidConnectionId' }); return; }
  try {
    res.json(await application.listConnectionGrants(req.authorization!, connectionId));
  } catch (error) { handleError(error, res); }
};

export const saveConnectionGrant = async (req: Request, res: Response): Promise<void> => {
  const connectionId = readPositiveInteger(req.params.connectionId);
  const groupId = readPositiveInteger(req.params.groupId);
  const permission = req.body.permission as 'view' | 'connect' | 'manage';
  if (!connectionId || !groupId || !CONNECTION_PERMISSION_SET.has(permission)) {
    res.status(400).json({ code: 'accessControl.invalidConnectionGrant' });
    return;
  }
  try {
    const grant = await application.saveConnectionGrant(req.authorization!, connectionId, { groupId, permission });
    await auditLogService.logAction('CONNECTION_GRANT_SAVED', { connectionId, groupId, permission });
    res.json(grant);
  } catch (error) { handleError(error, res); }
};

export const saveConnectionGrants = async (req: Request, res: Response): Promise<void> => {
  const connectionIds = Array.isArray(req.body.connectionIds) ? req.body.connectionIds.map(Number) : [];
  const groupIds = Array.isArray(req.body.groupIds) ? req.body.groupIds.map(Number) : [];
  const permission = req.body.permission as 'view' | 'connect' | 'manage';
  if (!CONNECTION_PERMISSION_SET.has(permission)) {
    res.status(400).json({ code: 'accessControl.invalidConnectionGrant' }); return;
  }
  try {
    const grants = await application.saveConnectionGrants(req.authorization!, { connectionIds, groupIds, permission });
    await auditLogService.logAction('CONNECTION_GRANTS_BATCH_SAVED', {
      connectionIds, groupIds, permission, grantCount: grants.length,
    });
    res.json(grants);
  } catch (error) { handleError(error, res); }
};

export const deleteConnectionGrant = async (req: Request, res: Response): Promise<void> => {
  const connectionId = readPositiveInteger(req.params.connectionId);
  const groupId = readPositiveInteger(req.params.groupId);
  if (!connectionId || !groupId) {
    res.status(400).json({ code: 'accessControl.invalidConnectionGrant' });
    return;
  }
  try {
    await application.deleteConnectionGrant(req.authorization!, connectionId, groupId);
    await auditLogService.logAction('CONNECTION_GRANT_DELETED', { connectionId, groupId });
    res.status(204).send();
  } catch (error) { handleError(error, res); }
};

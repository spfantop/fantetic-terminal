import { Request, Response } from 'express';

import { AccessControlApplication } from './access-control.application';
import { accessControlRepository } from './access-control.repository';
import { GroupRole } from './access-policy';

const application = new AccessControlApplication(accessControlRepository);
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
    res.status(201).json(group);
  } catch (error) { handleError(error, res); }
};

export const updateGroup = async (req: Request, res: Response): Promise<void> => {
  const groupId = readPositiveInteger(req.params.groupId);
  if (!groupId) { res.status(400).json({ code: 'accessControl.invalidGroupId' }); return; }
  try {
    res.json(await application.updateGroup(req.authorization!, groupId, {
      name: typeof req.body.name === 'string' ? req.body.name : '',
      description: typeof req.body.description === 'string' ? req.body.description : undefined,
    }));
  } catch (error) { handleError(error, res); }
};

export const deleteGroup = async (req: Request, res: Response): Promise<void> => {
  const groupId = readPositiveInteger(req.params.groupId);
  if (!groupId) { res.status(400).json({ code: 'accessControl.invalidGroupId' }); return; }
  try {
    await application.deleteGroup(req.authorization!, groupId);
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
    res.json(await application.saveMember(req.authorization!, groupId, { userId, role }));
  } catch (error) { handleError(error, res); }
};

export const deleteMember = async (req: Request, res: Response): Promise<void> => {
  const groupId = readPositiveInteger(req.params.groupId);
  const userId = readPositiveInteger(req.params.userId);
  if (!groupId || !userId) { res.status(400).json({ code: 'accessControl.invalidMembership' }); return; }
  try {
    await application.deleteMember(req.authorization!, groupId, userId);
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
    res.json(await application.saveConnectionGrant(req.authorization!, connectionId, { groupId, permission }));
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
    res.status(204).send();
  } catch (error) { handleError(error, res); }
};

import { NextFunction, Request, Response } from 'express';

import { getDb, getDbInstance } from '../database/connection';

const RESOURCE_TABLE_SET = new Set(['proxies', 'ssh_keys', 'connection_folders', 'tags']);

export const requireResourceOwner = (table: string) => {
  if (!RESOURCE_TABLE_SET.has(table)) throw new Error(`Unsupported owned resource table: ${table}`);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const id = Number(req.params.id ?? req.params.folderId);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ code: 'accessControl.invalidResourceId' });
      return;
    }
    const subject = req.authorization!;
    if (subject.runtime === 'desktop'
      || subject.systemRole === 'super_admin'
      || subject.systemRole === 'admin') {
      next();
      return;
    }
    const resource = await getDb<{ owner_user_id: number | null }>(
      await getDbInstance(),
      `SELECT owner_user_id FROM ${table} WHERE id = ?`,
      [id],
    );
    if (!resource) {
      res.status(404).json({ code: 'accessControl.resourceNotFound' });
      return;
    }
    if (resource.owner_user_id !== subject.userId) {
      res.status(403).json({ code: 'accessControl.resourceForbidden' });
      return;
    }
    next();
  };
};

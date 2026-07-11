import { NextFunction, Request, Response } from 'express';

import { AccessControlApplication } from './access-control.application';
import { accessControlRepository } from './access-control.repository';

const application = new AccessControlApplication(accessControlRepository);

export const requireConnectionPermission = (required: 'view' | 'connect' | 'manage') => (
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const connectionId = Number(req.params.id);
    if (!Number.isInteger(connectionId) || connectionId <= 0) {
      res.status(400).json({ code: 'accessControl.invalidConnectionId' });
      return;
    }
    try {
      await application.requireConnectionPermission(req.authorization!, connectionId, required);
      next();
    } catch (error) {
      const notFound = error instanceof Error && /not found/i.test(error.message);
      res.status(notFound ? 404 : 403).json({
        code: notFound ? 'accessControl.connectionNotFound' : 'accessControl.connectionForbidden',
      });
    }
  }
);

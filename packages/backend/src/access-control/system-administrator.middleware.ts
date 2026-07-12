import { NextFunction, Request, Response } from 'express';

export const requireSystemAdministrator = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const subject = req.authorization;
  if (!subject || (subject.runtime !== 'desktop'
      && subject.systemRole !== 'super_admin'
      && subject.systemRole !== 'admin')) {
    res.status(403).json({ code: 'accessControl.systemAdministratorRequired' });
    return;
  }
  next();
};

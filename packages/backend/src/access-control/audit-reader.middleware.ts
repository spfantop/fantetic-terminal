import { NextFunction, Request, Response } from 'express';

const AUDIT_READER_ROLES = new Set(['super_admin', 'admin', 'auditor']);

export const requireAuditReader = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const subject = req.authorization;
  if (!subject || (subject.runtime !== 'desktop' && !AUDIT_READER_ROLES.has(subject.systemRole))) {
    res.status(403).json({ code: 'accessControl.auditReaderRequired' });
    return;
  }
  next();
};

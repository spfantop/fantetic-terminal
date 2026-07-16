import type { Request, Response } from 'express';

export interface HealthDependencies {
  checkDatabase: () => Promise<void>;
  checkDisk: () => Promise<void>;
  checkBackupDirectory: () => Promise<void>;
}

export const createHealthHandlers = ({ checkDatabase, checkDisk, checkBackupDirectory }: HealthDependencies) => ({
  live: (_request: Request, response: Response): void => {
    response.json({ status: 'live' });
  },
  ready: async (_request: Request, response: Response): Promise<void> => {
    try {
      await checkDatabase();
      await checkDisk();
      await checkBackupDirectory();
      response.json({ status: 'ready', checks: { database: 'ready', disk: 'ready', backup: 'ready' } });
    } catch {
      response.status(503).json({ code: 'health.notReady' });
    }
  },
});

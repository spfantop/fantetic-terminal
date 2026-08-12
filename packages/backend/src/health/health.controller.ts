import type { Request, Response } from 'express';

export interface HealthDependencies {
  checkDatabase: () => Promise<void>;
  checkDisk: () => Promise<void>;
  checkBackupDirectory: () => Promise<void>;
  createRuntimeReadinessProof?: (headers: Request['headers']) => string | undefined;
}

export const createHealthHandlers = ({
  checkDatabase,
  checkDisk,
  checkBackupDirectory,
  createRuntimeReadinessProof,
}: HealthDependencies) => ({
  live: (_request: Request, response: Response): void => {
    response.json({ status: 'live' });
  },
  ready: async (request: Request, response: Response): Promise<void> => {
    try {
      await checkDatabase();
      await checkDisk();
      await checkBackupDirectory();
      const runtimeProof = createRuntimeReadinessProof?.(request.headers);
      if (runtimeProof) response.setHeader('x-fantetic-readiness-proof', runtimeProof);
      response.json({ status: 'ready', checks: { database: 'ready', disk: 'ready', backup: 'ready' } });
    } catch {
      response.status(503).json({ code: 'health.notReady' });
    }
  },
});

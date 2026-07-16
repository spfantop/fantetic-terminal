import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const createFilesystemReadinessChecks = ({
  appDataPath,
  backupDirectoryPath,
  minimumFreeBytes = Number(process.env.HEALTH_MIN_FREE_BYTES ?? 100 * 1024 * 1024),
}: {
  appDataPath: string;
  backupDirectoryPath: string;
  minimumFreeBytes?: number;
}) => {
  const checkDisk = async (): Promise<void> => {
    fs.mkdirSync(appDataPath, { recursive: true });
    const stats = fs.statfsSync(appDataPath);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(freeBytes) || freeBytes < minimumFreeBytes) {
      throw new Error('Insufficient free disk space for backend data.');
    }
  };
  const checkBackupDirectory = async (): Promise<void> => {
    fs.mkdirSync(backupDirectoryPath, { recursive: true });
    const probePath = path.join(backupDirectoryPath, `.healthcheck-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
    try {
      fs.writeFileSync(probePath, '', { encoding: 'utf8', flag: 'wx' });
    } finally {
      if (fs.existsSync(probePath)) fs.unlinkSync(probePath);
    }
  };
  return { checkDisk, checkBackupDirectory };
};

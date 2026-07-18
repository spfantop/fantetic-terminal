import fs from 'node:fs';
import path from 'node:path';

export const resolveRecordingPath = (rootPath: string, relativePath: string): string => {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Recording path escapes its storage root.');
  }
  return target;
};

export const readRecordingFileFingerprint = async (
  rootPath: string,
  relativePath: string,
): Promise<string> => {
  const stats = await fs.promises.stat(resolveRecordingPath(rootPath, relativePath));
  return [stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs].join(':');
};

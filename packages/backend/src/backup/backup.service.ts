import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface BackupManifest {
  formatVersion: 1;
  id: string;
  createdAt: string;
  schemaVersion: number;
  encryptionKeyFingerprint: string;
  files: Array<{ path: string; size: number; sha256: string }>;
}

export interface BackupRetentionPolicy {
  retentionCount: number;
  archiveRootPath?: string;
}

type BackupServiceDependencies = {
  appDataPath: string;
  snapshotDatabase: (targetPath: string) => Promise<void>;
  readSchemaVersion: () => Promise<number>;
  encryptionKey?: string;
  now?: () => Date;
};

const BACKUP_ID_PATTERN = /^\d{8}T\d{6}-[a-f0-9]{8}$/;
const BACKUP_CONTENT_NAMES = ['uploads', 'custom-html-themes', 'session-recordings'] as const;

const assertInside = (targetPath: string, parentPath: string): string => {
  const target = path.resolve(targetPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path must be inside ${parent}`);
  }
  return target;
};

const isInsideOrEqual = (targetPath: string, parentPath: string): boolean => {
  const relative = path.relative(parentPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const resolveArchiveRoot = (archiveRootPath: string, appDataPath: string): string => {
  if (!path.isAbsolute(archiveRootPath)) {
    throw new Error('Backup archive path must be absolute.');
  }
  const requestedRoot = path.resolve(archiveRootPath);
  const dataRoot = fs.realpathSync(appDataPath);
  if (isInsideOrEqual(requestedRoot, dataRoot) || isInsideOrEqual(dataRoot, requestedRoot)) {
    throw new Error('Backup archive path must not overlap the application data path.');
  }
  fs.mkdirSync(requestedRoot, { recursive: true });
  const archiveRoot = fs.realpathSync(requestedRoot);
  if (isInsideOrEqual(archiveRoot, dataRoot) || isInsideOrEqual(dataRoot, archiveRoot)) {
    throw new Error('Backup archive path must not overlap the application data path.');
  }
  return archiveRoot;
};

const assertRetentionCount = (retentionCount: number): void => {
  if (!Number.isInteger(retentionCount) || retentionCount < 1 || retentionCount > 365) {
    throw new Error('Backup retention count must be an integer between 1 and 365.');
  }
};

const sha256File = (filePath: string): string => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

const listFiles = (rootPath: string): string[] => {
  const result: string[] = [];
  const visit = (currentPath: string) => {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entry.name !== 'manifest.json') result.push(entryPath);
    }
  };
  visit(rootPath);
  return result.sort();
};

const keyFingerprint = (configuredKey?: string): string => {
  const key = configuredKey ?? process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY is required to create or restore backups.');
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
};

const formatBackupId = (date: Date): string => {
  const compact = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
  return `${compact}-${crypto.randomBytes(4).toString('hex')}`;
};

export const createBackupService = ({
  appDataPath,
  snapshotDatabase,
  readSchemaVersion,
  encryptionKey,
  now = () => new Date(),
}: BackupServiceDependencies) => {
  const backupsPath = path.join(appDataPath, 'backups');
  const restoreRequestPath = path.join(appDataPath, '.restore-request.json');
  fs.mkdirSync(backupsPath, { recursive: true });

  const backupPath = (backupId: string): string => {
    if (!BACKUP_ID_PATTERN.test(backupId)) throw new Error('Invalid backup ID.');
    return assertInside(path.join(backupsPath, backupId), backupsPath);
  };

  const readBackup = (backupId: string): BackupManifest => {
    const manifestPath = path.join(backupPath(backupId), 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
    if (manifest.formatVersion !== 1 || manifest.id !== backupId || !Array.isArray(manifest.files)) {
      throw new Error('Invalid backup manifest.');
    }
    return manifest;
  };

  const verifyBackup = async (backupId: string): Promise<{ valid: boolean; errors: string[]; manifest?: BackupManifest }> => {
    const errors: string[] = [];
    let manifest: BackupManifest;
    try { manifest = readBackup(backupId); }
    catch (error) { return { valid: false, errors: [error instanceof Error ? error.message : 'Invalid backup.'] }; }
    if (manifest.encryptionKeyFingerprint !== keyFingerprint(encryptionKey)) errors.push('Encryption key fingerprint mismatch.');
    const rootPath = backupPath(backupId);
    const actualFiles = new Set(listFiles(rootPath).map(filePath => path.relative(rootPath, filePath).split(path.sep).join('/')));
    const declaredFiles = new Set(manifest.files.map(file => file.path));
    for (const actualFile of actualFiles) {
      if (!declaredFiles.has(actualFile)) errors.push(`Unexpected file: ${actualFile}`);
    }
    for (const file of manifest.files) {
      if (!actualFiles.has(file.path)) { errors.push(`Missing file: ${file.path}`); continue; }
      const filePath = assertInside(path.join(rootPath, file.path), rootPath);
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size !== file.size || sha256File(filePath) !== file.sha256) {
        errors.push(`Integrity check failed: ${file.path}`);
      }
    }
    return { valid: errors.length === 0, errors, manifest };
  };

  const createBackup = async (): Promise<BackupManifest> => {
    const createdAt = now();
    const id = formatBackupId(createdAt);
    const finalPath = backupPath(id);
    const temporaryPath = assertInside(path.join(backupsPath, `.tmp-${id}`), backupsPath);
    fs.mkdirSync(temporaryPath, { recursive: true });
    try {
      await snapshotDatabase(path.join(temporaryPath, 'fantetic-terminal.db'));
      for (const name of BACKUP_CONTENT_NAMES) {
        const sourcePath = path.join(appDataPath, name);
        if (fs.existsSync(sourcePath)) fs.cpSync(sourcePath, path.join(temporaryPath, name), { recursive: true });
      }
      const files = listFiles(temporaryPath).map(filePath => {
        const stat = fs.statSync(filePath);
        return {
          path: path.relative(temporaryPath, filePath).split(path.sep).join('/'),
          size: stat.size,
          sha256: sha256File(filePath),
        };
      });
      const manifest: BackupManifest = {
        formatVersion: 1,
        id,
        createdAt: createdAt.toISOString(),
        schemaVersion: await readSchemaVersion(),
        encryptionKeyFingerprint: keyFingerprint(encryptionKey),
        files,
      };
      fs.writeFileSync(path.join(temporaryPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      fs.renameSync(temporaryPath, finalPath);
      return manifest;
    } catch (error) {
      fs.rmSync(temporaryPath, { recursive: true, force: true });
      throw error;
    }
  };

  const listBackups = (): BackupManifest[] => fs.readdirSync(backupsPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && BACKUP_ID_PATTERN.test(entry.name))
    .map(entry => readBackup(entry.name))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const countBackups = (): number => fs.readdirSync(backupsPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && BACKUP_ID_PATTERN.test(entry.name)).length;

  const archiveBackup = (backupId: string, archiveRootPath: string): string => {
    const archiveRoot = resolveArchiveRoot(archiveRootPath, appDataPath);
    const sourcePath = backupPath(backupId);
    const targetPath = assertInside(path.join(archiveRoot, backupId), archiveRoot);
    if (fs.existsSync(targetPath)) throw new Error('Backup archive target already exists.');
    const temporaryPath = assertInside(path.join(archiveRoot, `.tmp-${backupId}`), archiveRoot);
    try {
      fs.cpSync(sourcePath, temporaryPath, { recursive: true, errorOnExist: true });
      fs.renameSync(temporaryPath, targetPath);
      return targetPath;
    } catch (error) {
      fs.rmSync(temporaryPath, { recursive: true, force: true });
      throw error;
    }
  };

  const pruneBackups = (retentionCount: number, archiveRootPath?: string): string[] => {
    assertRetentionCount(retentionCount);
    const archiveRoot = archiveRootPath ? resolveArchiveRoot(archiveRootPath, appDataPath) : undefined;
    const expiredBackups = listBackups().slice(retentionCount);
    for (const backup of expiredBackups) {
      fs.rmSync(backupPath(backup.id), { recursive: true, force: false });
      if (archiveRoot) {
        fs.rmSync(assertInside(path.join(archiveRoot, backup.id), archiveRoot), { recursive: true, force: true });
      }
    }
    return expiredBackups.map(backup => backup.id);
  };

  const createBackupWithPolicy = async (policy: BackupRetentionPolicy): Promise<BackupManifest> => {
    assertRetentionCount(policy.retentionCount);
    const backup = await createBackup();
    if (policy.archiveRootPath) archiveBackup(backup.id, policy.archiveRootPath);
    pruneBackups(policy.retentionCount, policy.archiveRootPath);
    return backup;
  };

  const scheduleRestore = async (backupId: string): Promise<void> => {
    const verification = await verifyBackup(backupId);
    if (!verification.valid) throw new Error(`Backup integrity verification failed: ${verification.errors.join('; ')}`);
    const temporaryMarker = `${restoreRequestPath}.tmp`;
    fs.writeFileSync(temporaryMarker, `${JSON.stringify({ backupId, requestedAt: now().toISOString() })}\n`, 'utf8');
    fs.renameSync(temporaryMarker, restoreRequestPath);
  };

  return {
    createBackup,
    createBackupWithPolicy,
    listBackups,
    countBackups,
    readBackup,
    verifyBackup,
    scheduleRestore,
    archiveBackup,
    pruneBackups,
    backupsPath,
    restoreRequestPath,
  };
};

export const applyScheduledRestore = async (appDataPath: string, encryptionKey?: string): Promise<string | null> => {
  const markerPath = path.join(appDataPath, '.restore-request.json');
  if (!fs.existsSync(markerPath)) return null;
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as { backupId?: string };
  if (!marker.backupId) throw new Error('Invalid restore request.');
  const service = createBackupService({
    appDataPath,
    snapshotDatabase: async () => { throw new Error('Snapshot is unavailable during restore bootstrap.'); },
    readSchemaVersion: async () => 0,
    encryptionKey,
  });
  const verification = await service.verifyBackup(marker.backupId);
  if (!verification.valid) throw new Error(`Backup integrity verification failed: ${verification.errors.join('; ')}`);

  const sourceRoot = path.join(service.backupsPath, marker.backupId);
  const token = `${process.pid}-${Date.now()}`;
  const targets = ['fantetic-terminal.db', ...BACKUP_CONTENT_NAMES];
  const swaps: Array<{ target: string; rollback: string; hadTarget: boolean }> = [];

  try {
    for (const name of targets) {
      const target = assertInside(path.join(appDataPath, name), appDataPath);
      const source = assertInside(path.join(sourceRoot, name), sourceRoot);
      const staging = assertInside(path.join(appDataPath, `.restore-stage-${token}-${name}`), appDataPath);
      const rollback = assertInside(path.join(appDataPath, `.restore-rollback-${token}-${name}`), appDataPath);
      if (fs.existsSync(source)) fs.cpSync(source, staging, { recursive: true });
      else if (name !== 'fantetic-terminal.db') fs.mkdirSync(staging, { recursive: true });
      else throw new Error('Backup database snapshot is missing.');
      const hadTarget = fs.existsSync(target);
      if (hadTarget) fs.renameSync(target, rollback);
      fs.renameSync(staging, target);
      swaps.push({ target, rollback, hadTarget });
    }
    for (const suffix of ['-wal', '-shm']) fs.rmSync(path.join(appDataPath, `fantetic-terminal.db${suffix}`), { force: true });
    for (const swap of swaps) if (swap.hadTarget) fs.rmSync(swap.rollback, { recursive: true, force: true });
    fs.rmSync(markerPath, { force: true });
    return marker.backupId;
  } catch (error) {
    for (const swap of swaps.reverse()) {
      fs.rmSync(swap.target, { recursive: true, force: true });
      if (swap.hadTarget && fs.existsSync(swap.rollback)) fs.renameSync(swap.rollback, swap.target);
    }
    throw error;
  }
};

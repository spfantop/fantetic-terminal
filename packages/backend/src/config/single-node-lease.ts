import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface SingleNodeLease {
  enabled: boolean;
  release: () => void;
}

type LeaseDocument = {
  instanceId: string;
  leaseToken: string;
  pid: number;
  startedAt: number;
  heartbeatAt: number;
};

type AcquireSingleNodeLeaseOptions = {
  appDataPath: string;
  enabled: boolean;
  instanceId?: string;
  heartbeatIntervalMs?: number;
  staleAfterMs?: number;
  now?: () => number;
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const MAX_ACQUIRE_ATTEMPTS = 5;

const readBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('SINGLE_NODE_LOCK_ENABLED must be true or false.');
};

export const resolveSingleNodeLeaseEnabled = (
  environment: Record<string, string | undefined> = process.env,
): boolean => readBoolean(
  environment.SINGLE_NODE_LOCK_ENABLED,
  environment.FANTETIC_APP_MODE !== 'electron',
);

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const parseLeaseDocument = (content: string): LeaseDocument | null => {
  try {
    const value = JSON.parse(content) as Partial<LeaseDocument>;
    if (
      typeof value.instanceId !== 'string'
      || typeof value.leaseToken !== 'string'
      || !Number.isInteger(value.pid)
      || typeof value.startedAt !== 'number'
      || typeof value.heartbeatAt !== 'number'
    ) {
      return null;
    }
    return value as LeaseDocument;
  } catch {
    return null;
  }
};

const isStaleLease = (lease: LeaseDocument | null, now: number, staleAfterMs: number): boolean => (
  lease === null
  || !isProcessRunning(lease.pid)
  || now - lease.heartbeatAt > staleAfterMs
);

/**
 * SQLite sessions, nonce replay state and uploads are all local to one data
 * directory. This lease prevents two Web processes from accidentally sharing
 * that directory; it is deliberately not a replacement for distributed HA.
 */
export const acquireSingleNodeLease = ({
  appDataPath,
  enabled,
  instanceId = crypto.randomUUID(),
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  now = Date.now,
}: AcquireSingleNodeLeaseOptions): SingleNodeLease => {
  if (!enabled) {
    return {
      enabled: false,
      release: () => undefined,
    };
  }

  const runtimePath = path.join(appDataPath, 'runtime');
  const lockPath = path.join(runtimePath, 'single-node.lock');
  const leaseToken = crypto.randomUUID();
  const startedAt = now();
  fs.mkdirSync(runtimePath, { recursive: true, mode: 0o700 });

  const createLock = (): void => {
    const descriptor = fs.openSync(lockPath, 'wx', 0o600);
    try {
      const lease: LeaseDocument = {
        instanceId,
        leaseToken,
        pid: process.pid,
        startedAt,
        heartbeatAt: now(),
      };
      fs.writeFileSync(descriptor, JSON.stringify(lease), 'utf8');
    } finally {
      fs.closeSync(descriptor);
    }
  };

  let acquired = false;
  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS && !acquired; attempt += 1) {
    try {
      createLock();
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    let existingLease: LeaseDocument | null;
    try {
      existingLease = parseLeaseDocument(fs.readFileSync(lockPath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!isStaleLease(existingLease, now(), staleAfterMs)) {
      throw new Error('Another Fantetic Terminal node already owns the shared data directory.');
    }

    const stalePath = `${lockPath}.stale-${process.pid}-${crypto.randomUUID()}`;
    try {
      // Renaming is atomic on the same filesystem and prevents two contenders
      // from deleting a replacement lease created by the other contender.
      fs.renameSync(lockPath, stalePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }

    try {
      const movedLease = parseLeaseDocument(fs.readFileSync(stalePath, 'utf8'));
      if (!isStaleLease(movedLease, now(), staleAfterMs)) {
        try {
          fs.renameSync(stalePath, lockPath);
        } catch {
          // A concurrent owner won the lock; the normal owned error still applies.
        }
        throw new Error('Another Fantetic Terminal node already owns the shared data directory.');
      }
      createLock();
      acquired = true;
    } finally {
      fs.rmSync(stalePath, { force: true });
    }
  }

  if (!acquired) {
    throw new Error('Another Fantetic Terminal node already owns the shared data directory.');
  }

  let released = false;
  const heartbeat = setInterval(() => {
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(lockPath, 'r+');
      const currentLease = parseLeaseDocument(fs.readFileSync(descriptor, 'utf8'));
      if (currentLease?.leaseToken !== leaseToken) {
        clearInterval(heartbeat);
        return;
      }
      const refreshedLease: LeaseDocument = { ...currentLease, heartbeatAt: now() };
      fs.ftruncateSync(descriptor, 0);
      fs.writeFileSync(descriptor, JSON.stringify(refreshedLease), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        clearInterval(heartbeat);
      }
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }, heartbeatIntervalMs);
  heartbeat.unref();

  return {
    enabled: true,
    release: () => {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      try {
        const currentLease = parseLeaseDocument(fs.readFileSync(lockPath, 'utf8'));
        if (currentLease?.leaseToken === leaseToken) fs.unlinkSync(lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
  };
};

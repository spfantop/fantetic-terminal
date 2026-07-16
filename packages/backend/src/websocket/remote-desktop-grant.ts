import { createHash } from 'node:crypto';

interface RemoteDesktopGrant {
  userId: number;
  connectionId: number;
  protocol?: 'RDP' | 'VNC';
  connectionName?: string;
  requestId?: string;
  expiresAt: number;
}

interface RemoteDesktopGrantRegistryOptions {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export class RemoteDesktopGrantRegistry {
  private readonly grantMap = new Map<string, RemoteDesktopGrant>();
  private readonly now: () => number;

  constructor(private readonly options: RemoteDesktopGrantRegistryOptions) {
    this.now = options.now ?? Date.now;
  }

  register(
    token: string,
    userId: number,
    connectionId: number,
    metadata?: Pick<RemoteDesktopGrant, 'protocol' | 'connectionName' | 'requestId'>,
  ): void {
    this.cleanup();
    while (this.grantMap.size >= this.options.maxEntries) {
      const oldestKey = this.grantMap.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.grantMap.delete(oldestKey);
    }
    this.grantMap.set(hashToken(token), { userId, connectionId, ...metadata, expiresAt: this.now() + this.options.ttlMs });
  }

  consume(token: string, userId: number): Omit<RemoteDesktopGrant, 'userId' | 'expiresAt'> | undefined {
    const key = hashToken(token);
    const grant = this.grantMap.get(key);
    if (!grant) return undefined;
    if (grant.expiresAt <= this.now()) {
      this.grantMap.delete(key);
      return undefined;
    }
    if (grant.userId !== userId) return undefined;
    this.grantMap.delete(key);
    return {
      connectionId: grant.connectionId,
      protocol: grant.protocol,
      connectionName: grant.connectionName,
      ...(grant.requestId ? { requestId: grant.requestId } : {}),
    };
  }

  private cleanup(): void {
    const now = this.now();
    for (const [key, grant] of this.grantMap) if (grant.expiresAt <= now) this.grantMap.delete(key);
  }
}

export const remoteDesktopGrantRegistry = new RemoteDesktopGrantRegistry({ ttlMs: 30_000, maxEntries: 10_000 });

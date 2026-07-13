import { isCorsOriginAllowed, readForwardedHost } from '../config/cors-origin';

export type WebSocketRoute = 'standard' | 'rdp';

export const classifyWebSocketPath = (pathname: string | null | undefined): WebSocketRoute | null => {
  if (pathname === '/ws/' || pathname === '/ws') return 'standard';
  if (pathname === '/ws/rdp-proxy' || pathname === '/rdp-proxy') return 'rdp';
  return null;
};

export const isWebSocketOriginAllowed = (
  origin: string | undefined,
  configuredOrigins: ReadonlySet<string>,
  requestOrigin: string | undefined,
  allowMissingOrigin: boolean,
): boolean => {
  if (!origin) return allowMissingOrigin;
  return isCorsOriginAllowed(origin, configuredOrigins, requestOrigin);
};

export const readWebSocketRequestOrigin = (headers: Record<string, string | string[] | undefined>, encrypted: boolean): string | undefined => {
  const host = readForwardedHost(typeof headers['x-forwarded-host'] === 'string' ? headers['x-forwarded-host'] : undefined)
    || (typeof headers.host === 'string' ? headers.host : undefined);
  if (!host) return undefined;
  const forwardedProto = typeof headers['x-forwarded-proto'] === 'string'
    ? headers['x-forwarded-proto'].split(',')[0]?.trim()
    : undefined;
  return `${forwardedProto || (encrypted ? 'https' : 'http')}://${host}`;
};

interface FixedWindowAdmissionLimiterOptions {
  windowMs: number;
  maxAttempts: number;
  maxEntries: number;
  now?: () => number;
}

interface AdmissionWindow {
  startedAt: number;
  attempts: number;
}

export class FixedWindowAdmissionLimiter {
  private readonly windowMap = new Map<string, AdmissionWindow>();
  private readonly now: () => number;

  constructor(private readonly options: FixedWindowAdmissionLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  allow(key: string): boolean {
    const now = this.now();
    const current = this.windowMap.get(key);
    if (!current || now - current.startedAt >= this.options.windowMs) {
      this.ensureCapacity(now);
      this.windowMap.set(key, { startedAt: now, attempts: 1 });
      return true;
    }
    current.attempts += 1;
    return current.attempts <= this.options.maxAttempts;
  }

  private ensureCapacity(now: number): void {
    for (const [key, entry] of this.windowMap) {
      if (now - entry.startedAt >= this.options.windowMs) this.windowMap.delete(key);
    }
    while (this.windowMap.size >= this.options.maxEntries) {
      const oldestKey = this.windowMap.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.windowMap.delete(oldestKey);
    }
  }
}

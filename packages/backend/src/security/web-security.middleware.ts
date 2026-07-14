import { NextFunction, Request, RequestHandler, Response } from 'express';
import { readForwardedHost } from '../config/cors-origin';

interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  maxEntries?: number;
  now?: () => number;
  key: (request: Request) => string;
}

type RateEntry = { count: number; resetAt: number };

export const createFixedWindowRateLimiter = ({
  windowMs,
  maxRequests,
  maxEntries = 10_000,
  now = Date.now,
  key,
}: RateLimiterOptions): RequestHandler => {
  const entryMap = new Map<string, RateEntry>();
  return (request, response, next): void => {
    const currentTime = now();
    const requestKey = key(request) || 'unknown';
    let entry = entryMap.get(requestKey);
    if (!entry || currentTime >= entry.resetAt) {
      entry = { count: 0, resetAt: currentTime + windowMs };
      entryMap.delete(requestKey);
      entryMap.set(requestKey, entry);
    }
    entry.count += 1;
    response.setHeader('X-RateLimit-Limit', String(maxRequests));
    response.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));
    if (entry.count > maxRequests) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1_000))));
      response.status(429).json({ code: 'security.rateLimitExceeded' });
      return;
    }
    while (entryMap.size > maxEntries) entryMap.delete(entryMap.keys().next().value as string);
    next();
  };
};

const normalizeOrigin = (origin: string): string => origin.trim().replace(/\/$/, '').toLowerCase();

export const validateMutationOrigin = (allowedOriginSet: Set<string>): RequestHandler => {
  const normalizedAllowedOriginSet = new Set([...allowedOriginSet].map(normalizeOrigin));
  return (request, response, next): void => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
      next();
      return;
    }
    const origin = request.get('origin');
    const requestHost = (readForwardedHost(request.get('x-forwarded-host')) || request.get('host'))?.toLowerCase();
    let sameRequestOrigin = false;
    try { sameRequestOrigin = !!requestHost && new URL(origin || '').host.toLowerCase() === requestHost; } catch { /* invalid origin */ }
    // Native clients and server-to-server callers may omit Origin; browser mutations always include it.
    if (!origin || sameRequestOrigin || normalizedAllowedOriginSet.has(normalizeOrigin(origin))) {
      next();
      return;
    }
    response.status(403).json({ code: 'security.untrustedOrigin' });
  };
};

interface JsonComplexityOptions {
  maxDepth: number;
  maxKeys: number;
  maxStringLength: number;
}

export const validateJsonComplexity = (options: JsonComplexityOptions): RequestHandler => (
  request,
  response,
  next,
): void => {
  let keyCount = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: request.body, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > options.maxDepth) {
      response.status(413).json({ code: 'security.payloadTooComplex' });
      return;
    }
    if (typeof current.value === 'string' && current.value.length > options.maxStringLength) {
      response.status(413).json({ code: 'security.payloadTooComplex' });
      return;
    }
    if (!current.value || typeof current.value !== 'object') continue;
    const childList = Array.isArray(current.value) ? current.value : Object.values(current.value);
    keyCount += childList.length;
    if (keyCount > options.maxKeys) {
      response.status(413).json({ code: 'security.payloadTooComplex' });
      return;
    }
    for (const child of childList) stack.push({ value: child, depth: current.depth + 1 });
  }
  next();
};

export const securityHeaders = (request: Request, response: Response, next: NextFunction): void => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (request.secure) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
};

export const apiErrorHandler = (
  error: Error & { status?: number; type?: string },
  _request: Request,
  response: Response,
  next: NextFunction,
): void => {
  if (error.status === 413 || error.type === 'entity.too.large') {
    response.status(413).json({ code: 'security.payloadTooLarge' });
    return;
  }
  if (error instanceof SyntaxError && error.status === 400) {
    response.status(400).json({ code: 'security.invalidJson' });
    return;
  }
  next(error);
};

export const authenticationRateLimitKey = (request: Request): string => {
  const username = typeof request.body?.username === 'string'
    ? request.body.username.trim().toLowerCase().slice(0, 128)
    : '-';
  return `${request.ip || 'unknown'}:${username}`;
};

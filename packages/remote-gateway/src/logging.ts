export type GatewayLogLevel = 'debug' | 'info' | 'warn' | 'error';

const sensitiveKey = /password|passwd|secret|token|authorization|cookie|private.?key|passphrase|credential/i;
const sensitiveValue = /\b(password|passwd|secret|token|authorization|cookie|private[_-]?key|passphrase|credential)\s*([=:])\s*(?:bearer\s+)?([^\s,;]+)/gi;
const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

const redactText = (value: string): string => value.replace(
  sensitiveValue,
  (_match, key: string, separator: string) => `${key}${separator}[REDACTED]`,
);

const sanitize = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value instanceof Error) return {
    name: value.name,
    message: redactText(value.message),
    ...(value.stack ? { stack: redactText(value.stack) } : {}),
  };
  if (typeof value === 'string') return redactText(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key, sensitiveKey.test(key) ? '[REDACTED]' : sanitize(child, seen),
  ]));
};

export const createGatewayLogger = (component: string, write: (level: GatewayLogLevel, line: string) => void = (level, line) => {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}) => {
  const log = (level: GatewayLogLevel, message: string, context?: Record<string, unknown>) => {
    const { requestId: contextRequestId, ...remainingContext } = context ?? {};
    const requestId = typeof contextRequestId === 'string' && requestIdPattern.test(contextRequestId)
      ? contextRequestId
      : undefined;
    write(level, JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      ...(requestId ? { requestId } : {}),
      ...(context ? { context: sanitize(remainingContext) } : {}),
    }));
  };
  return {
    debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
    info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
    warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
    error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
  };
};

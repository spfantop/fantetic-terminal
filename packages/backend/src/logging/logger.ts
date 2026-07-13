export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  production?: boolean;
  now?: () => Date;
  write?: (level: LogLevel, line: string) => void;
}

const SENSITIVE_KEY = /password|passwd|secret|token|authorization|cookie|private.?key|passphrase|credential/i;

const sanitize = (value: unknown, seen = new WeakSet<object>(), depth = 0): unknown => {
  if (depth > 8) return '[TRUNCATED]';
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, seen, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitize(child, seen, depth + 1),
  ]));
};

const defaultWrite = (level: LogLevel, line: string): void => {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export const createLogger = (component: string, options: LoggerOptions = {}) => {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const now = options.now ?? (() => new Date());
  const write = options.write ?? defaultWrite;
  const log = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
    const record = {
      timestamp: now().toISOString(),
      level,
      component,
      message,
      ...(context ? { context: sanitize(context) } : {}),
    };
    write(level, production
      ? JSON.stringify(record)
      : `[${record.timestamp}] [${level.toUpperCase()}] [${component}] ${message}${context ? ` ${JSON.stringify(record.context)}` : ''}`);
  };
  return {
    debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
    info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
    warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
    error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
  };
};

export const ELECTRON_FRONTEND_ORIGINS = [
  'http://localhost:22457',
  'http://127.0.0.1:22457',
] as const;

const normalizeOrigin = (value: string | undefined): string | undefined => {
  if (!value) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

export const parseCorsOrigins = (...values: Array<string | undefined>): Set<string> => {
  const origins = new Set<string>();

  for (const value of values) {
    for (const candidate of value?.split(',') ?? []) {
      const origin = normalizeOrigin(candidate.trim());
      if (origin) origins.add(origin);
    }
  }

  return origins;
};

export const isCorsOriginAllowed = (
  origin: string | undefined,
  configuredOrigins: ReadonlySet<string>,
  requestOrigin: string | undefined,
): boolean => {
  if (!origin) return true;

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;

  return configuredOrigins.has(normalizedOrigin)
    || normalizedOrigin === normalizeOrigin(requestOrigin);
};

export const readForwardedHost = (value: string | undefined): string | undefined => (
  value?.split(',')[0]?.trim() || undefined
);

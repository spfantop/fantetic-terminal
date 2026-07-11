type ServerBindingInput = {
  appMode: string | undefined;
  host: string | undefined;
  port: string | number | undefined;
};

export type ServerBinding = {
  host: string;
  port: number;
};

const LOOPBACK_HOST_SET = new Set(['127.0.0.1', '::1', 'localhost']);

export const resolveServerBinding = ({ appMode, host, port }: ServerBindingInput): ServerBinding => {
  const electronMode = appMode === 'electron';
  const resolvedHost = host?.trim() || (electronMode ? '127.0.0.1' : '0.0.0.0');
  const resolvedPort = Number(port ?? 3001);

  if (!Number.isInteger(resolvedPort) || resolvedPort < 1 || resolvedPort > 65535) {
    throw new Error(`Invalid server port: ${String(port)}`);
  }

  if (electronMode && !LOOPBACK_HOST_SET.has(resolvedHost.toLowerCase())) {
    throw new Error(`Electron app mode requires a loopback host, received: ${resolvedHost}`);
  }

  return { host: resolvedHost, port: resolvedPort };
};

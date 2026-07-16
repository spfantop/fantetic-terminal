import net from 'node:net';

export type GatewayHealthState = {
  guacamoleReady: boolean;
};

export const isGuacdReachable = ({
  host,
  port,
  timeoutMs = 1_000,
}: {
  host: string;
  port: number;
  timeoutMs?: number;
}): Promise<boolean> => new Promise((resolve) => {
  let socket: net.Socket;
  try {
    socket = net.createConnection({ host, port });
  } catch {
    resolve(false);
    return;
  }
  let settled = false;
  const finish = (reachable: boolean): void => {
    if (settled) return;
    settled = true;
    socket.destroy();
    resolve(reachable);
  };
  socket.setTimeout(timeoutMs);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
});

export const createHealthSnapshot = ({ guacamoleReady }: GatewayHealthState) => ({
  status: guacamoleReady ? 'ready' : 'not_ready',
  checks: {
    guacamole: guacamoleReady ? 'ready' : 'not_ready',
  },
});

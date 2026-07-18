import type WebSocket from 'ws';
import type { WebSocketServer } from 'ws';

import { createLogger } from '../logging/logger';
import type { AuthenticatedWebSocket } from './types';

const logger = createLogger('WebSocketHeartbeat');
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_MISSED_LIMIT = 3;

type HeartbeatOptions = {
  intervalMs?: number;
  missedLimit?: number;
  cleanupClientConnection: (sessionId: string | undefined) => void;
  scheduleInterval?: (callback: () => void, intervalMs: number) => NodeJS.Timeout;
  cancelInterval?: (timer: NodeJS.Timeout) => void;
};

export function initializeHeartbeat(
  wss: WebSocketServer,
  options: HeartbeatOptions,
): NodeJS.Timeout {
  const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  const missedLimit = options.missedLimit ?? HEARTBEAT_MISSED_LIMIT;
  const cleanupClientConnection = options.cleanupClientConnection;
  const scheduleInterval = options.scheduleInterval ?? setInterval;
  const cancelInterval = options.cancelInterval ?? clearInterval;
  const heartbeatInterval = scheduleInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
      const authenticatedSocket = ws as AuthenticatedWebSocket;
      if (authenticatedSocket.isAlive === false) {
        authenticatedSocket.missedHeartbeatCount = (authenticatedSocket.missedHeartbeatCount ?? 0) + 1;
        if (authenticatedSocket.missedHeartbeatCount >= missedLimit) {
          logger.warn('WebSocket 心跳连续无响应，正在终止连接', {
            sessionId: authenticatedSocket.sessionId,
            missedHeartbeatCount: authenticatedSocket.missedHeartbeatCount,
          });
          cleanupClientConnection(authenticatedSocket.sessionId);
          authenticatedSocket.terminate();
          return;
        }
      } else {
        authenticatedSocket.missedHeartbeatCount = 0;
      }
      authenticatedSocket.isAlive = false;
      authenticatedSocket.ping(() => undefined);
    });
  }, intervalMs);

  wss.on('close', () => {
    cancelInterval(heartbeatInterval);
  });

  logger.info('WebSocket 心跳检测已初始化', {
    intervalMs,
    missedLimit,
  });
  return heartbeatInterval;
}

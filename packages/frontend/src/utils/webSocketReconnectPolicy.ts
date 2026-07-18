export const MAX_WEBSOCKET_RECONNECT_ATTEMPTS = 8;

const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_JITTER_RATIO = 0.2;

export const resolveWebSocketReconnectDelayMs = (
  attempt: number,
  random: () => number = Math.random,
) => {
  const normalizedAttempt = Math.max(1, Math.trunc(attempt));
  const baseDelay = Math.min(MAX_RECONNECT_DELAY_MS, 2 ** normalizedAttempt * 1_000);
  const boundedRandom = Math.min(1, Math.max(0, random()));
  const jitterMultiplier = 1 - RECONNECT_JITTER_RATIO + boundedRandom * RECONNECT_JITTER_RATIO * 2;
  return Math.round(baseDelay * jitterMultiplier);
};

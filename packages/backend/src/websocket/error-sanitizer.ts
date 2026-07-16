import type WebSocket from 'ws';

const GENERIC_WEBSOCKET_ERROR_MESSAGE = '操作失败，请稍后重试。';

const isErrorMessage = (value: unknown): value is { type: string; payload?: unknown } => (
  typeof value === 'object'
  && value !== null
  && typeof (value as { type?: unknown }).type === 'string'
  && (
    (value as { type: string }).type === 'error'
    || (value as { type: string }).type.endsWith(':error')
    || (value as { type: string }).type === 'sftp_error'
    || (value as { payload?: { success?: unknown } }).payload?.success === false
  )
);

const sanitizeErrorPayload = (payload: unknown): unknown => {
  if (typeof payload === 'string') return GENERIC_WEBSOCKET_ERROR_MESSAGE;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;

  const sanitizedPayload = { ...(payload as Record<string, unknown>) };
  for (const key of ['message', 'error', 'reason']) {
    if (typeof sanitizedPayload[key] === 'string') sanitizedPayload[key] = GENERIC_WEBSOCKET_ERROR_MESSAGE;
  }
  return sanitizedPayload;
};

/**
 * 对历史 WebSocket 处理器的错误事件做最后一道脱敏，避免动态异常文本穿透协议边界。
 * 正常事件及已结构化的成功数据保持原样。
 */
export const installWebSocketErrorSanitizer = (webSocket: Pick<WebSocket, 'send'>): void => {
  const originalSend = webSocket.send.bind(webSocket);
  webSocket.send = ((data: WebSocket.RawData, ...args: unknown[]) => {
    if (typeof data !== 'string') return originalSend(data, ...(args as []));

    try {
      const message = JSON.parse(data) as unknown;
      if (!isErrorMessage(message)) return originalSend(data, ...(args as []));
      return originalSend(JSON.stringify({ ...message, payload: sanitizeErrorPayload(message.payload) }), ...(args as []));
    } catch {
      return originalSend(data, ...(args as []));
    }
  }) as WebSocket['send'];
};

import type {
  LatencyPongMessage,
  SshOutputServerMessage,
  TerminalConnectedPayload,
  TerminalConnectedServerMessage,
} from '@fantetic-terminal/contracts';

export interface LegacyServerMessage {
  type: string;
  payload?: unknown;
  [field: string]: unknown;
}

export type DecodedServerMessage =
  | { kind: 'terminal-connected'; message: TerminalConnectedServerMessage }
  | { kind: 'latency-pong'; message: LatencyPongMessage }
  | { kind: 'ssh-output'; message: SshOutputServerMessage }
  | { kind: 'legacy'; message: LegacyServerMessage };

export class WebSocketProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebSocketProtocolError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const SSH_OUTPUT_BINARY_HEADER = new Uint8Array([0x53, 0x53, 0x48, 0x4f]);
const BASE64_PAYLOAD_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const readBinaryFrame = (rawData: unknown): Uint8Array | null => {
  if (rawData instanceof ArrayBuffer) return new Uint8Array(rawData);
  if (!ArrayBuffer.isView(rawData)) return null;
  return new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength);
};

const decodeSshOutputBinaryFrame = (rawData: unknown): DecodedServerMessage | null => {
  const bytes = readBinaryFrame(rawData);
  if (!bytes) return null;
  const hasHeader = bytes.length >= SSH_OUTPUT_BINARY_HEADER.length
    && SSH_OUTPUT_BINARY_HEADER.every((value, index) => bytes[index] === value);
  if (!hasHeader) throw new WebSocketProtocolError('Unknown binary WebSocket frame.');

  return {
    kind: 'ssh-output',
    message: {
      type: 'ssh:output',
      payload: bytes.subarray(SSH_OUTPUT_BINARY_HEADER.length),
      encoding: 'binary',
    },
  };
};

const isTerminalConnectedPayload = (value: unknown): value is TerminalConnectedPayload => (
  isRecord(value)
  && typeof value.connectionId === 'number'
  && Number.isInteger(value.connectionId)
  && value.connectionId > 0
  && typeof value.sessionId === 'string'
  && value.sessionId.length > 0
  && isRecord(value.serverCapabilities)
  && typeof value.serverCapabilities.sshBinaryInput === 'boolean'
  && typeof value.serverCapabilities.sshBinaryOutput === 'boolean'
);

const isLatencyPongMessage = (value: unknown): value is LatencyPongMessage => {
  if (!isRecord(value) || value.type !== 'client:pong' || !isRecord(value.payload)) return false;
  return typeof value.payload.id === 'string'
    && value.payload.id.length > 0
    && typeof value.payload.sentAt === 'number'
    && Number.isFinite(value.payload.sentAt)
    && value.payload.sentAt > 0
    && typeof value.payload.sessionId === 'string'
    && value.payload.sessionId.length > 0
    && typeof value.payload.serverAt === 'number'
    && Number.isFinite(value.payload.serverAt);
};

const parseJsonMessage = (rawData: unknown): LegacyServerMessage => {
  const messageText = rawData?.toString?.() ?? String(rawData);
  let parsed: unknown;
  try {
    parsed = JSON.parse(messageText);
  } catch {
    throw new WebSocketProtocolError('WebSocket frame is not valid JSON.');
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string' || parsed.type.length === 0) {
    throw new WebSocketProtocolError('WebSocket message must contain a non-empty type.');
  }
  return parsed as LegacyServerMessage;
};

export const decodeServerMessageFrame = (rawData: unknown): DecodedServerMessage => {
  const binaryMessage = decodeSshOutputBinaryFrame(rawData);
  if (binaryMessage) return binaryMessage;

  const message = parseJsonMessage(rawData);
  if (message.type === 'ssh:connected' || message.type === 'telnet:connected') {
    if (!isTerminalConnectedPayload(message.payload)) {
      throw new WebSocketProtocolError(`${message.type} has an invalid payload.`);
    }
    return {
      kind: 'terminal-connected',
      message: message as TerminalConnectedServerMessage,
    };
  }
  if (message.type === 'client:pong') {
    if (!isLatencyPongMessage(message)) {
      throw new WebSocketProtocolError('client:pong has an invalid payload.');
    }
    return { kind: 'latency-pong', message };
  }
  if (message.type === 'ssh:output') {
    if (
      message.encoding !== 'base64'
      || typeof message.payload !== 'string'
      || !BASE64_PAYLOAD_PATTERN.test(message.payload)
    ) {
      throw new WebSocketProtocolError('ssh:output has an invalid payload.');
    }
    return {
      kind: 'ssh-output',
      message: {
        type: 'ssh:output',
        payload: message.payload,
        encoding: 'base64',
      },
    };
  }

  return { kind: 'legacy', message };
};

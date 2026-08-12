import type {
  CoreServerMessage,
  LatencyPingMessage,
  LatencyPongMessage,
} from '@fantetic-terminal/contracts';

export const encodeCoreServerMessage = (message: CoreServerMessage): string => JSON.stringify(message);

const SSH_OUTPUT_BINARY_HEADER = Buffer.from([0x53, 0x53, 0x48, 0x4f]);

export const encodeSshOutputFrame = (output: Buffer, binary: boolean): Buffer | string => (
  binary
    ? Buffer.concat([SSH_OUTPUT_BINARY_HEADER, output], SSH_OUTPUT_BINARY_HEADER.byteLength + output.byteLength)
    : `{"type":"ssh:output","payload":"${output.toString('base64')}","encoding":"base64"}`
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isLatencyPingMessage = (message: unknown): message is LatencyPingMessage => {
  if (!isRecord(message) || message.type !== 'client:ping' || !isRecord(message.payload)) return false;
  return typeof message.payload.id === 'string'
    && message.payload.id.length > 0
    && typeof message.payload.sentAt === 'number'
    && Number.isFinite(message.payload.sentAt)
    && message.payload.sentAt > 0
    && typeof message.payload.sessionId === 'string'
    && message.payload.sessionId.length > 0;
};

export const createLatencyPongMessage = (
  message: unknown,
  serverAt = Date.now(),
): LatencyPongMessage => {
  if (!isLatencyPingMessage(message)) throw new Error('client:ping has an invalid payload.');
  return {
    type: 'client:pong',
    payload: { ...message.payload, serverAt },
  };
};

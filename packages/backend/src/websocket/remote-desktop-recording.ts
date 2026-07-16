/**
 * Captures the two directions of a Guacamole WebSocket before persistent
 * storage is ready. This prevents a fast client from losing its initial
 * protocol instructions while the recording row is created in SQLite.
 */
export interface RemoteDesktopProtocolRecorder {
  recordGuacamoleClient(data: Buffer): void;
  recordGuacamoleServer(data: Buffer): void;
  markIncomplete(): void;
  finish(endedAt: number): Promise<void>;
}

export interface RemoteDesktopRecordingBridgeOptions {
  start: () => Promise<RemoteDesktopProtocolRecorder | undefined>;
  maxPendingBytes?: number;
}

type PendingFrame = { direction: 'client' | 'server'; data: Buffer };

const DEFAULT_MAX_PENDING_BYTES = 1024 * 1024;

export const createRemoteDesktopRecordingBridge = (options: RemoteDesktopRecordingBridgeOptions) => {
  const pendingFrameList: PendingFrame[] = [];
  const maxPendingBytes = options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES;
  let pendingBytes = 0;
  let recorder: RemoteDesktopProtocolRecorder | undefined;
  let incomplete = false;
  let finished = false;

  const write = (direction: PendingFrame['direction'], data: Buffer): void => {
    const copy = Buffer.from(data);
    if (recorder) {
      if (direction === 'client') recorder.recordGuacamoleClient(copy);
      else recorder.recordGuacamoleServer(copy);
      return;
    }
    if (pendingBytes + copy.byteLength > maxPendingBytes) {
      incomplete = true;
      return;
    }
    pendingFrameList.push({ direction, data: copy });
    pendingBytes += copy.byteLength;
  };

  const ready = options.start().then(result => {
    recorder = result;
    for (const frame of pendingFrameList) write(frame.direction, frame.data);
    pendingFrameList.length = 0;
    pendingBytes = 0;
  });

  return {
    ready,
    recordClient(data: Buffer): void {
      if (!finished) write('client', data);
    },
    recordServer(data: Buffer): void {
      if (!finished) write('server', data);
    },
    async finish(options: { incomplete?: boolean } = {}): Promise<void> {
      if (finished) return;
      finished = true;
      if (options.incomplete) incomplete = true;
      try {
        await ready;
      } catch {
        return;
      }
      if (!recorder) return;
      if (incomplete) recorder.markIncomplete();
      await recorder.finish(Date.now());
    },
  };
};

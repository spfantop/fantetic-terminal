import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { SessionRecordingEvent } from '@fantetic-terminal/contracts';

import { decrypt, encrypt } from '../utils/crypto';
import { createLogger } from '../logging/logger';

const logger = createLogger('SessionRecorder');

export type RecordingEvent = SessionRecordingEvent;

type PendingRecordingEvent =
  | { offsetMs: number; type: 'output' | 'input'; data: Buffer }
  | { offsetMs: number; type: 'resize'; cols: number; rows: number };

export interface RecordingSummary {
  eventCount: number;
  byteCount: number;
  incomplete: boolean;
}

interface RecorderOptions {
  rootPath: string;
  recordingId: string;
  startedAt: number;
  flushIntervalMs?: number;
  maxPendingBytes?: number;
  now?: () => number;
  onComplete: (summary: RecordingSummary) => Promise<void>;
}

const DEFAULT_FLUSH_INTERVAL_MS = 20;
const DEFAULT_MAX_PENDING_BYTES = 8 * 1024 * 1024;

const resolveRecordingPath = (rootPath: string, relativePath: string): string => {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Recording path escapes its storage root.');
  }
  return target;
};

export const createSessionRecorder = (options: RecorderOptions) => {
  const now = options.now ?? (() => options.startedAt);
  const relativePath = path.join(
    new Date(options.startedAt).toISOString().slice(0, 7),
    `${options.recordingId}.jsonl.enc`,
  );
  const filePath = resolveRecordingPath(options.rootPath, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const stream = fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
  const pendingEventList: PendingRecordingEvent[] = [];
  let pendingBytes = 0;
  let byteCount = 0;
  let eventCount = 0;
  let incomplete = false;
  let timer: NodeJS.Timeout | undefined;
  let finished = false;
  let writeChain = Promise.resolve();
  stream.on('error', error => {
    incomplete = true;
    logger.error('录像文件流错误', { error });
  });

  const flush = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (pendingEventList.length === 0) return;
    const pendingBatch = pendingEventList.splice(0, pendingEventList.length);
    pendingBytes = 0;
    writeChain = writeChain.then(() => new Promise<void>((resolve, reject) => {
      const batch: RecordingEvent[] = pendingBatch.map(event => event.type === 'resize' ? event : ({
        ...event,
        data: event.data.toString('base64'),
      }));
      const line = `${encrypt(JSON.stringify(batch))}\n`;
      byteCount += Buffer.byteLength(line);
      stream.write(line, error => error ? reject(error) : resolve());
    })).catch(error => {
      incomplete = true;
      logger.error('写入录像失败', { error });
    });
  };

  const scheduleFlush = (): void => {
    if (!timer) timer = setTimeout(flush, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
  };

  const enqueue = (event: PendingRecordingEvent, size: number): void => {
    if (finished) return;
    if (pendingBytes + size > (options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES)) {
      incomplete = true;
      return;
    }
    pendingEventList.push(event);
    pendingBytes += size;
    eventCount += 1;
    scheduleFlush();
  };

  const offsetMs = (): number => Math.max(0, now() - options.startedAt);

  return {
    relativePath,
    recordOutput(data: Buffer): void {
      enqueue({ offsetMs: offsetMs(), type: 'output', data: Buffer.from(data) }, data.byteLength);
    },
    recordInput(data: Buffer): void {
      enqueue({ offsetMs: offsetMs(), type: 'input', data: Buffer.from(data) }, data.byteLength);
    },
    recordResize(cols: number, rows: number): void {
      enqueue({ offsetMs: offsetMs(), type: 'resize', cols, rows }, 16);
    },
    async finish(_endedAt: number): Promise<void> {
      if (finished) return;
      finished = true;
      flush();
      await writeChain;
      await new Promise<void>((resolve, reject) => stream.end((error?: Error | null) => error ? reject(error) : resolve()));
      await options.onComplete({ eventCount, byteCount, incomplete });
    },
  };
};

export const readRecordingEvents = async (
  rootPath: string,
  relativePath: string,
): Promise<RecordingEvent[]> => {
  const filePath = resolveRecordingPath(rootPath, relativePath);
  const content = await fs.promises.readFile(filePath, 'utf8');
  return content.split('\n').filter(Boolean).flatMap(line => (
    JSON.parse(decrypt(line)) as RecordingEvent[]
  ));
};

export const readRecordingEventPage = async (
  rootPath: string,
  relativePath: string,
  cursor = 0,
  limit = 100,
): Promise<{ eventList: RecordingEvent[]; nextCursor: number | null }> => {
  const filePath = resolveRecordingPath(rootPath, relativePath);
  const safeCursor = Number.isFinite(cursor) ? Math.max(0, Math.floor(cursor)) : 0;
  const safeLimit = Number.isFinite(limit) ? Math.min(200, Math.max(1, Math.floor(limit))) : 100;
  const reader = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const eventList: RecordingEvent[] = [];
  let lineIndex = 0;
  let hasMore = false;
  for await (const line of reader) {
    if (lineIndex < safeCursor) {
      lineIndex += 1;
      continue;
    }
    if (lineIndex >= safeCursor + safeLimit) {
      hasMore = true;
      break;
    }
    if (line) eventList.push(...JSON.parse(decrypt(line)) as RecordingEvent[]);
    lineIndex += 1;
  }
  reader.close();
  return { eventList, nextCursor: hasMore ? safeCursor + safeLimit : null };
};

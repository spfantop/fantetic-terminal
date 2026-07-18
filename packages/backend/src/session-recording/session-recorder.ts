import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import type { SessionRecordingEvent } from '@fantetic-terminal/contracts';

import { decrypt, encrypt } from '../utils/crypto';
import { createLogger } from '../logging/logger';
import { backendMetrics } from '../observability/metrics';

const logger = createLogger('SessionRecorder');

export type RecordingEvent = SessionRecordingEvent;

interface RecordingBatch {
  eventList: RecordingEvent[];
  previousHash: string | null;
  hash: string;
}

export type RecordingIntegrityResult = {
  status: 'valid' | 'legacy' | 'invalid';
  eventCount: number;
  batchCount: number;
  finalHash: string | null;
  reason?: 'corrupt-batch' | 'invalid-batch' | 'previous-hash-mismatch' | 'hash-mismatch';
};

type PendingBinaryRecordingEventType = 'output' | 'input' | 'guacamole-client' | 'guacamole-server';

type PendingRecordingEvent =
  | { offsetMs: number; type: PendingBinaryRecordingEventType; data: Buffer }
  | { offsetMs: number; type: 'resize'; cols: number; rows: number };

export interface RecordingSummary {
  eventCount: number;
  byteCount: number;
  incomplete: boolean;
  batchCount: number;
  finalHash: string | null;
}

interface RecorderOptions {
  rootPath: string;
  recordingId: string;
  startedAt: number;
  flushIntervalMs?: number;
  maxPendingBytes?: number;
  now?: () => number;
  writeLine?: (line: string) => Promise<void>;
  onComplete: (summary: RecordingSummary) => Promise<void>;
}

const DEFAULT_FLUSH_INTERVAL_MS = 20;
const DEFAULT_MAX_PENDING_BYTES = 8 * 1024 * 1024;

const hashRecordingBatch = (previousHash: string | null, eventList: RecordingEvent[]): string => crypto
  .createHash('sha256')
  .update(previousHash ?? '')
  .update('\n')
  .update(JSON.stringify(eventList))
  .digest('hex');

const isRecordingBatch = (value: unknown): value is RecordingBatch => Boolean(value)
  && typeof value === 'object'
  && Array.isArray((value as RecordingBatch).eventList)
  && ((value as RecordingBatch).previousHash === null || typeof (value as RecordingBatch).previousHash === 'string')
  && typeof (value as RecordingBatch).hash === 'string';

const parseRecordingLine = (line: string): RecordingEvent[] => {
  const value: unknown = JSON.parse(decrypt(line));
  if (Array.isArray(value)) return value as RecordingEvent[];
  if (isRecordingBatch(value)) return value.eventList;
  throw new Error('Recording batch has an invalid format.');
};

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
  let queuedBytes = 0;
  let byteCount = 0;
  let eventCount = 0;
  let incomplete = false;
  let timer: NodeJS.Timeout | undefined;
  let finished = false;
  let writeChain = Promise.resolve();
  let previousBatchHash: string | null = null;
  let batchCount = 0;
  stream.on('error', error => {
    incomplete = true;
    logger.error('录像文件流错误', { error });
  });

  const writeLine = options.writeLine ?? ((line: string) => new Promise<void>((resolve, reject) => {
    stream.write(line, error => {
      if (error) reject(error);
      else resolve();
    });
  }));

  const flush = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (pendingEventList.length === 0) return;
    const pendingBatch = pendingEventList.splice(0, pendingEventList.length);
    const pendingBatchBytes = pendingBatch.reduce((total, event) => (
      total + (event.type === 'resize' ? 16 : event.data.byteLength)
    ), 0);
    writeChain = writeChain.then(async () => {
      try {
        const batch: RecordingEvent[] = pendingBatch.map(event => event.type === 'resize' ? event : ({
          ...event,
          data: event.data.toString('base64'),
        }));
        const batchHash = hashRecordingBatch(previousBatchHash, batch);
        const line = `${encrypt(JSON.stringify({ eventList: batch, previousHash: previousBatchHash, hash: batchHash }))}\n`;
        await writeLine(line);
        previousBatchHash = batchHash;
        batchCount += 1;
        byteCount += Buffer.byteLength(line);
      } finally {
        queuedBytes = Math.max(0, queuedBytes - pendingBatchBytes);
      }
    }).catch(error => {
      incomplete = true;
      logger.error('写入录像失败', { error });
    });
  };

  const scheduleFlush = (): void => {
    if (!timer) timer = setTimeout(flush, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
  };

  const enqueue = (event: PendingRecordingEvent, size: number): void => {
    if (finished) return;
    if (queuedBytes + size > (options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES)) {
      incomplete = true;
      backendMetrics.recordRecordingQueueRejected();
      return;
    }
    pendingEventList.push(event);
    queuedBytes += size;
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
    recordGuacamoleClient(data: Buffer): void {
      enqueue({ offsetMs: offsetMs(), type: 'guacamole-client', data: Buffer.from(data) }, data.byteLength);
    },
    recordGuacamoleServer(data: Buffer): void {
      enqueue({ offsetMs: offsetMs(), type: 'guacamole-server', data: Buffer.from(data) }, data.byteLength);
    },
    recordResize(cols: number, rows: number): void {
      enqueue({ offsetMs: offsetMs(), type: 'resize', cols, rows }, 16);
    },
    markIncomplete(): void {
      incomplete = true;
    },
    async finish(_endedAt: number): Promise<void> {
      if (finished) return;
      finished = true;
      flush();
      await writeChain;
      await new Promise<void>((resolve, reject) => stream.end((error?: Error | null) => error ? reject(error) : resolve()));
      await options.onComplete({ eventCount, byteCount, incomplete, batchCount, finalHash: previousBatchHash });
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
    parseRecordingLine(line)
  ));
};

/**
 * Streams only server-to-client Guacamole instructions without retaining a
 * complete remote-desktop recording in Backend memory.
 */
export async function* readGuacamoleServerRecordingChunks(
  rootPath: string,
  relativePath: string,
): AsyncGenerator<Buffer> {
  const filePath = resolveRecordingPath(rootPath, relativePath);
  const reader = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of reader) {
      if (!line) continue;
      for (const event of parseRecordingLine(line)) {
        if (event.type === 'guacamole-server') {
          yield Buffer.from(event.data, 'base64');
        }
      }
    }
  } finally {
    reader.close();
  }
}

export const verifyRecordingIntegrity = async (
  rootPath: string,
  relativePath: string,
): Promise<RecordingIntegrityResult> => {
  const filePath = resolveRecordingPath(rootPath, relativePath);
  const lineList = (await fs.promises.readFile(filePath, 'utf8')).split('\n').filter(Boolean);
  let previousHash: string | null = null;
  let eventCount = 0;

  for (let index = 0; index < lineList.length; index += 1) {
    let value: unknown;
    try {
      value = JSON.parse(decrypt(lineList[index]));
    } catch {
      return { status: 'invalid', eventCount, batchCount: index, finalHash: previousHash, reason: 'corrupt-batch' };
    }
    if (Array.isArray(value)) {
      eventCount += value.length;
      return { status: 'legacy', eventCount, batchCount: index + 1, finalHash: null };
    }
    if (!isRecordingBatch(value)) {
      return { status: 'invalid', eventCount, batchCount: index, finalHash: previousHash, reason: 'invalid-batch' };
    }
    eventCount += value.eventList.length;
    if (value.previousHash !== previousHash) {
      return { status: 'invalid', eventCount, batchCount: index + 1, finalHash: previousHash, reason: 'previous-hash-mismatch' };
    }
    if (value.hash !== hashRecordingBatch(previousHash, value.eventList)) {
      return { status: 'invalid', eventCount, batchCount: index + 1, finalHash: previousHash, reason: 'hash-mismatch' };
    }
    previousHash = value.hash;
  }

  return { status: 'valid', eventCount, batchCount: lineList.length, finalHash: previousHash };
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
    if (line) eventList.push(...parseRecordingLine(line));
    lineIndex += 1;
  }
  reader.close();
  return { eventList, nextCursor: hasMore ? safeCursor + safeLimit : null };
};

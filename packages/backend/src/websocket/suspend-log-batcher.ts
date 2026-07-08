import { temporaryLogStorageService } from '../ssh-suspend/temporary-log-storage.service';

const SUSPEND_LOG_FLUSH_DELAY_MS = 64;
const SUSPEND_LOG_MAX_PENDING_BYTES = 256 * 1024;

export interface SuspendLogBatcher {
    path: string;
    pendingTextList: string[];
    pendingBytes: number;
    flushTimer?: NodeJS.Timeout;
}

const suspendLogBatchers = new Map<string, SuspendLogBatcher>();

export function createSuspendLogBatcher(path: string): SuspendLogBatcher {
    const existing = suspendLogBatchers.get(path);
    if (existing) return existing;

    const batcher: SuspendLogBatcher = {
        path,
        pendingTextList: [],
        pendingBytes: 0,
    };
    suspendLogBatchers.set(path, batcher);
    return batcher;
}

export function appendSuspendLogBatch(path: string, text: string): void {
    if (!text) return;

    const batcher = createSuspendLogBatcher(path);
    batcher.pendingTextList.push(text);
    batcher.pendingBytes += Buffer.byteLength(text);

    if (batcher.pendingBytes >= SUSPEND_LOG_MAX_PENDING_BYTES) {
        void flushSuspendLogBatcher(path);
        return;
    }

    if (batcher.flushTimer) return;
    batcher.flushTimer = setTimeout(() => {
        void flushSuspendLogBatcher(path);
    }, SUSPEND_LOG_FLUSH_DELAY_MS);
}

export async function flushSuspendLogBatcher(path: string): Promise<void> {
    const batcher = suspendLogBatchers.get(path);
    if (!batcher) return;

    if (batcher.flushTimer) {
        clearTimeout(batcher.flushTimer);
        batcher.flushTimer = undefined;
    }

    const text = batcher.pendingTextList.join('');
    batcher.pendingTextList.length = 0;
    batcher.pendingBytes = 0;
    suspendLogBatchers.delete(path);

    if (!text) return;
    await temporaryLogStorageService.writeToLog(path, text);
}

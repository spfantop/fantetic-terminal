import { reactive, onUnmounted, type Ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../types/sftp.types';
import type { UploadItem } from '../types/upload.types';
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types';
import type { WebSocketDependencies } from './useSftpActions';
import { debugLog } from './useDebugLog';

const SFTP_UPLOAD_CHUNK_SIZE = 64 * 1024;
const SFTP_UPLOAD_BUFFERED_AMOUNT_LIMIT = 2 * 1024 * 1024;
const SFTP_UPLOAD_BUFFER_RETRY_MS = 50;
const MAX_CONCURRENT_UPLOADS = 1;

type UploadRuntimeState = {
    remotePath: string;
    relativePath?: string;
    offset: number;
    chunkIndex: number;
    active: boolean;
    sending: boolean;
    waitingForAck: boolean;
    bufferRetryTimer: ReturnType<typeof setTimeout> | null;
};

const generateUploadId = (): string => {
    return `upload-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

const joinPath = (base: string, name: string): string => {
    if (base === '/') return `/${name}`;
    if (base.endsWith('/')) return `${base}${name}`;
    return `${base}/${name}`;
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
};

const readChunkAsArrayBuffer = (file: File, offset: number): Promise<ArrayBuffer> => {
    const slice = file.slice(offset, offset + SFTP_UPLOAD_CHUNK_SIZE);
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (reader.result instanceof ArrayBuffer) {
                resolve(reader.result);
                return;
            }
            reject(new Error('FileReader returned non-ArrayBuffer result'));
        };
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.readAsArrayBuffer(slice);
    });
};

export function useFileUploader(
    sessionIdForLog: Ref<string>,
    currentPathRef: Ref<string>,
    fileListRef: Readonly<Ref<readonly FileListItem[]>>,
    wsDeps: Ref<WebSocketDependencies>
) {
    const { t } = useI18n();
    void fileListRef;

    const uploads = reactive<Record<string, UploadItem>>({});
    const uploadRuntimeStates = new Map<string, UploadRuntimeState>();
    const uploadQueue: string[] = [];
    let activeUploadCount = 0;

    const removeQueuedUpload = (uploadId: string) => {
        const queueIndex = uploadQueue.indexOf(uploadId);
        if (queueIndex !== -1) uploadQueue.splice(queueIndex, 1);
    };

    const clearRuntimeTimer = (runtime: UploadRuntimeState | undefined) => {
        if (runtime?.bufferRetryTimer) {
            clearTimeout(runtime.bufferRetryTimer);
            runtime.bufferRetryTimer = null;
        }
    };

    const scheduleUploadQueue = () => {
        while (activeUploadCount < MAX_CONCURRENT_UPLOADS && uploadQueue.length > 0) {
            const uploadId = uploadQueue.shift();
            if (!uploadId) continue;

            const upload = uploads[uploadId];
            const runtime = uploadRuntimeStates.get(uploadId);
            if (!upload || !runtime || upload.status !== 'pending') {
                uploadRuntimeStates.delete(uploadId);
                continue;
            }

            if (!wsDeps.value.isConnected.value) {
                upload.status = 'error';
                upload.error = t('workspace.status.wsClosed', 'WebSocket 连接已关闭');
                uploadRuntimeStates.delete(uploadId);
                continue;
            }

            runtime.active = true;
            activeUploadCount += 1;
            debugLog(`[FileUploader ${sessionIdForLog.value}] Starting queued upload ${uploadId} to ${runtime.remotePath}`);
            wsDeps.value.sendMessage({
                type: 'sftp:upload:start',
                payload: {
                    uploadId,
                    remotePath: runtime.remotePath,
                    size: upload.file.size,
                    relativePath: runtime.relativePath || undefined,
                },
            });
        }
    };

    const finishUploadRuntime = (uploadId: string) => {
        const runtime = uploadRuntimeStates.get(uploadId);
        clearRuntimeTimer(runtime);
        removeQueuedUpload(uploadId);
        if (runtime?.active) {
            activeUploadCount = Math.max(0, activeUploadCount - 1);
        }
        uploadRuntimeStates.delete(uploadId);
        scheduleUploadQueue();
    };

    const failUpload = (uploadId: string, message: string, notifyBackend = true) => {
        const upload = uploads[uploadId];
        if (!upload) {
            finishUploadRuntime(uploadId);
            return;
        }

        upload.status = 'error';
        upload.error = message;

        const runtime = uploadRuntimeStates.get(uploadId);
        if (notifyBackend && runtime?.active && wsDeps.value.isConnected.value) {
            wsDeps.value.sendMessage({ type: 'sftp:upload:cancel', payload: { uploadId } });
        }
        finishUploadRuntime(uploadId);

        setTimeout(() => {
            if (uploads[uploadId]?.status === 'error') {
                delete uploads[uploadId];
            }
        }, 5000);
    };

    const retryWhenSocketBufferDrains = (uploadId: string, runtime: UploadRuntimeState) => {
        if (runtime.bufferRetryTimer !== null) return;
        runtime.bufferRetryTimer = setTimeout(() => {
            runtime.bufferRetryTimer = null;
            void sendNextUploadChunk(uploadId);
        }, SFTP_UPLOAD_BUFFER_RETRY_MS);
    };

    const sendNextUploadChunk = async (uploadId: string) => {
        const upload = uploads[uploadId];
        const runtime = uploadRuntimeStates.get(uploadId);
        if (!upload || !runtime || upload.status !== 'uploading') return;
        if (runtime.sending || runtime.waitingForAck) return;

        if (!wsDeps.value.isConnected.value) {
            failUpload(uploadId, t('workspace.status.wsClosed', 'WebSocket 连接已关闭'), false);
            return;
        }

        const bufferedAmount = wsDeps.value.getBufferedAmount?.() ?? 0;
        if (bufferedAmount > SFTP_UPLOAD_BUFFERED_AMOUNT_LIMIT) {
            retryWhenSocketBufferDrains(uploadId, runtime);
            return;
        }

        runtime.sending = true;
        try {
            const isZeroByteFile = upload.file.size === 0;
            const buffer = isZeroByteFile ? new ArrayBuffer(0) : await readChunkAsArrayBuffer(upload.file, runtime.offset);
            const byteLength = buffer.byteLength;
            const isLast = isZeroByteFile || runtime.offset + byteLength >= upload.file.size;

            if (!uploads[uploadId] || uploads[uploadId].status !== 'uploading') return;

            wsDeps.value.sendMessage({
                type: 'sftp:upload:chunk',
                payload: {
                    uploadId,
                    chunkIndex: runtime.chunkIndex,
                    data: arrayBufferToBase64(buffer),
                    byteLength: byteLength,
                    isLast: isLast,
                },
            });
            runtime.waitingForAck = true;
        } catch (error: any) {
            console.error(`[FileUploader ${sessionIdForLog.value}] FileReader error for upload ID: ${uploadId}`, error);
            failUpload(uploadId, t('fileManager.errors.readFileError'));
        } finally {
            const currentRuntime = uploadRuntimeStates.get(uploadId);
            if (currentRuntime) currentRuntime.sending = false;
        }
    };

    const startFileUpload = (file: File, relativePath?: string) => {
        if (!wsDeps.value.isConnected.value) {
            console.warn(`[FileUploader ${sessionIdForLog.value}] Cannot start upload: WebSocket not connected.`);
            return;
        }

        const uploadId = generateUploadId();

        let finalRemotePath: string;
        if (relativePath) {
            const basePath = currentPathRef.value.endsWith('/') ? currentPathRef.value : `${currentPathRef.value}/`;
            let cleanRelativePath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
            cleanRelativePath = cleanRelativePath.endsWith('/') ? cleanRelativePath.slice(0, -1) : cleanRelativePath;
            finalRemotePath = `${basePath}${cleanRelativePath ? cleanRelativePath + '/' : ''}${file.name}`;
        } else {
            finalRemotePath = joinPath(currentPathRef.value, file.name);
        }
        finalRemotePath = finalRemotePath.replace(/\/+/g, '/');

        uploads[uploadId] = {
            id: uploadId,
            file,
            filename: file.name,
            progress: 0,
            status: 'pending',
        };

        uploadRuntimeStates.set(uploadId, {
            remotePath: finalRemotePath,
            relativePath,
            offset: 0,
            chunkIndex: 0,
            active: false,
            sending: false,
            waitingForAck: false,
            bufferRetryTimer: null,
        });
        uploadQueue.push(uploadId);
        debugLog(`[FileUploader ${sessionIdForLog.value}] Queued upload ${uploadId} to ${finalRemotePath}`);
        scheduleUploadQueue();
    };

    const cancelUpload = (uploadId: string, notifyBackend = true) => {
        const upload = uploads[uploadId];
        if (!upload || !['pending', 'uploading', 'paused'].includes(upload.status)) return;

        debugLog(`[FileUploader ${sessionIdForLog.value}] Cancelling upload ${uploadId}`);
        upload.status = 'cancelled';

        const runtime = uploadRuntimeStates.get(uploadId);
        if (notifyBackend && runtime?.active && wsDeps.value.isConnected.value) {
            wsDeps.value.sendMessage({ type: 'sftp:upload:cancel', payload: { uploadId } });
        }

        finishUploadRuntime(uploadId);
        setTimeout(() => {
            if (uploads[uploadId]?.status === 'cancelled') {
                delete uploads[uploadId];
            }
        }, 3000);
    };

    const onUploadReady = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;

        const upload = uploads[uploadId];
        if (upload && upload.status === 'pending') {
            debugLog(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} ready, sending first chunk.`);
            upload.status = 'uploading';
            void sendNextUploadChunk(uploadId);
        } else {
            console.warn(`[FileUploader ${sessionIdForLog.value}] Received upload:ready for unknown or non-pending upload ID: ${uploadId}`);
        }
    };

    const onUploadChunkAck = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;

        const upload = uploads[uploadId];
        const runtime = uploadRuntimeStates.get(uploadId);
        if (!upload || !runtime || upload.status !== 'uploading') return;

        if (typeof payload?.chunkIndex === 'number' && payload.chunkIndex !== runtime.chunkIndex) {
            console.warn(`[FileUploader ${sessionIdForLog.value}] Ignoring out-of-order ack for ${uploadId}. Expected ${runtime.chunkIndex}, got ${payload.chunkIndex}`);
            return;
        }

        const byteLength = typeof payload?.byteLength === 'number' ? payload.byteLength : 0;
        runtime.offset += byteLength;
        runtime.chunkIndex += 1;
        runtime.waitingForAck = false;

        if (typeof payload?.bytesWritten === 'number' && typeof payload?.totalSize === 'number') {
            upload.progress = payload.totalSize > 0
                ? Math.min(100, Math.round((payload.bytesWritten / payload.totalSize) * 100))
                : 100;
        }

        if (payload?.isLast === true || runtime.offset >= upload.file.size) {
            return;
        }
        void sendNextUploadChunk(uploadId);
    };

    const onUploadSuccess = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;

        const upload = uploads[uploadId];
        if (upload) {
            debugLog(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} successful.`);
            upload.status = 'success';
            upload.progress = 100;
            finishUploadRuntime(uploadId);
            delete uploads[uploadId];
        } else {
            console.warn(`[FileUploader ${sessionIdForLog.value}] Received upload:success for unknown upload ID: ${uploadId}`);
        }
    };

    const onUploadError = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) {
            console.warn(`[FileUploader ${sessionIdForLog.value}] Received upload:error with missing uploadId:`, message);
            return;
        }

        const errorMessage = typeof payload === 'string'
            ? payload
            : (payload?.message || t('fileManager.errors.uploadFailed'));
        console.error(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} error:`, errorMessage);
        failUpload(uploadId, errorMessage, false);
    };

    const onUploadPause = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;
        const upload = uploads[uploadId];
        const runtime = uploadRuntimeStates.get(uploadId);
        if (upload && upload.status === 'uploading') {
            debugLog(`[FileUploader ${sessionIdForLog.value}] Upload ${uploadId} paused.`);
            upload.status = 'paused';
            if (runtime) runtime.waitingForAck = false;
        }
    };

    const onUploadResume = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;
        const upload = uploads[uploadId];
        if (upload && upload.status === 'paused') {
            debugLog(`[FileUploader ${sessionIdForLog.value}] Resuming upload ${uploadId}`);
            upload.status = 'uploading';
            void sendNextUploadChunk(uploadId);
        }
    };

    const onUploadCancelled = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;
        const upload = uploads[uploadId];
        if (upload) {
            if (upload.status !== 'cancelled') {
                upload.status = 'cancelled';
            }
            finishUploadRuntime(uploadId);
            setTimeout(() => {
                if (uploads[uploadId]?.status === 'cancelled') {
                    delete uploads[uploadId];
                }
            }, 3000);
        }
    };

    const onUploadProgress = (payload: MessagePayload, message: WebSocketMessage) => {
        const uploadId = message.uploadId || payload?.uploadId;
        if (!uploadId) return;

        const upload = uploads[uploadId];
        if (upload && upload.status === 'uploading') {
            if (typeof payload?.bytesWritten === 'number' && typeof payload?.totalSize === 'number') {
                upload.progress = payload.totalSize > 0
                    ? Math.min(100, Math.round((payload.bytesWritten / payload.totalSize) * 100))
                    : 100;
            } else {
                console.warn(`[FileUploader ${sessionIdForLog.value}] Received upload:progress with incorrect payload format:`, payload);
            }
        } else if (!upload) {
            console.warn(`[FileUploader ${sessionIdForLog.value}] Received upload:progress for unknown upload ID: ${uploadId}`);
        }
    };

    watchEffect((onCleanup) => {
        if (!wsDeps.value || !wsDeps.value.onMessage) {
            console.warn(`[FileUploader ${sessionIdForLog.value}] wsDeps.value or wsDeps.value.onMessage is not available for registering listeners.`);
            return;
        }

        const unregisterUploadReady = wsDeps.value.onMessage('sftp:upload:ready', onUploadReady);
        const unregisterUploadChunkAck = wsDeps.value.onMessage('sftp:upload:chunk:ack', onUploadChunkAck);
        const unregisterUploadSuccess = wsDeps.value.onMessage('sftp:upload:success', onUploadSuccess);
        const unregisterUploadError = wsDeps.value.onMessage('sftp:upload:error', onUploadError);
        const unregisterUploadPause = wsDeps.value.onMessage('sftp:upload:pause', onUploadPause);
        const unregisterUploadResume = wsDeps.value.onMessage('sftp:upload:resume', onUploadResume);
        const unregisterUploadCancelled = wsDeps.value.onMessage('sftp:upload:cancelled', onUploadCancelled);
        const unregisterUploadProgress = wsDeps.value.onMessage('sftp:upload:progress', onUploadProgress);

        onCleanup(() => {
            unregisterUploadReady?.();
            unregisterUploadChunkAck?.();
            unregisterUploadSuccess?.();
            unregisterUploadError?.();
            unregisterUploadPause?.();
            unregisterUploadResume?.();
            unregisterUploadCancelled?.();
            unregisterUploadProgress?.();
        });
    });

    onUnmounted(() => {
        Object.keys(uploads).forEach(uploadId => {
            cancelUpload(uploadId, true);
        });
        uploadRuntimeStates.forEach(clearRuntimeTimer);
        uploadRuntimeStates.clear();
        uploadQueue.length = 0;
        activeUploadCount = 0;
    });

    return {
        uploads,
        startFileUpload,
        cancelUpload,
    };
}

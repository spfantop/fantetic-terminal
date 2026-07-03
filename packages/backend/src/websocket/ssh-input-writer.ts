import type { ClientState } from './types';

export type SshInputChunk = string | Buffer;

const MAX_PENDING_SSH_INPUT_BYTES = 8 * 1024 * 1024;
const SSH_INPUT_OVERFLOW_WARN_INTERVAL_MS = 5000;

const getInputChunkBytes = (data: SshInputChunk): number => (
    typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
);

function warnInputOverflow(state: ClientState): void {
    const now = Date.now();
    if (state.lastSshInputOverflowWarnAt && now - state.lastSshInputOverflowWarnAt < SSH_INPUT_OVERFLOW_WARN_INTERVAL_MS) {
        return;
    }

    state.lastSshInputOverflowWarnAt = now;
    console.warn(`SSH: 会话 ${state.ws.sessionId || 'unknown'} 输入缓冲超过限制，已丢弃新的输入片段。`);
}

function enqueueSshInput(state: ClientState, data: SshInputChunk): void {
    const pendingByteCount = state.pendingSshInputByteCount ?? 0;
    const dataBytes = getInputChunkBytes(data);
    if (pendingByteCount + dataBytes > MAX_PENDING_SSH_INPUT_BYTES) {
        warnInputOverflow(state);
        return;
    }

    if (!state.pendingSshInputBuffer) {
        state.pendingSshInputBuffer = [];
    }

    state.pendingSshInputBuffer.push(data);
    state.pendingSshInputByteCount = pendingByteCount + dataBytes;
}

function attachDrainHandler(state: ClientState): void {
    if (state.sshInputDrainHandler || !state.sshShellStream) {
        return;
    }

    const handler = () => {
        state.sshInputDrainHandler = undefined;
        state.isSshInputBackpressured = false;
        flushSshInput(state);
    };

    state.sshInputDrainHandler = handler;
    state.sshShellStream.once('drain', handler);
}

const mergeInputChunks = (chunkList: SshInputChunk[]): SshInputChunk => {
    if (chunkList.length === 1) return chunkList[0];
    if (chunkList.every(chunk => typeof chunk === 'string')) return chunkList.join('');

    return Buffer.concat(chunkList.map(chunk => (
        typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    )));
};

export function flushSshInput(state: ClientState): void {
    if (!state.sshShellStream || !state.isShellReady || state.isSshInputBackpressured) {
        return;
    }

    const chunkList = state.pendingSshInputBuffer;
    if (!chunkList?.length) {
        state.pendingSshInputByteCount = 0;
        return;
    }

    const data = mergeInputChunks(chunkList);
    state.pendingSshInputBuffer = [];
    state.pendingSshInputByteCount = 0;

    const canContinue = state.sshShellStream.write(data);
    if (!canContinue) {
        state.isSshInputBackpressured = true;
        attachDrainHandler(state);
    }
}

export function writeSshInput(state: ClientState, data: SshInputChunk): void {
    if (!state.sshShellStream || !state.isShellReady || getInputChunkBytes(data) === 0) {
        return;
    }

    if (state.isSshInputBackpressured || state.pendingSshInputBuffer?.length) {
        enqueueSshInput(state, data);
        attachDrainHandler(state);
        return;
    }

    const canContinue = state.sshShellStream.write(data);
    if (!canContinue) {
        state.isSshInputBackpressured = true;
        attachDrainHandler(state);
    }
}

export function clearSshInputQueue(state: ClientState): void {
    if (state.sshShellStream && state.sshInputDrainHandler) {
        state.sshShellStream.off('drain', state.sshInputDrainHandler);
    }

    state.pendingSshInputBuffer = undefined;
    state.pendingSshInputByteCount = 0;
    state.isSshInputBackpressured = false;
    state.sshInputDrainHandler = undefined;
}
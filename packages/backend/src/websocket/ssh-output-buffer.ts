import WebSocket from 'ws';
import type { ClientState } from './types';
import { encodeSshOutputFrame } from './core-server-message';

const MAX_SSH_OUTPUT_FRAME_BYTES = 32 * 1024;
const MAX_PENDING_SSH_OUTPUT_BYTES = 8 * 1024 * 1024;
const SSH_OUTPUT_BUFFERED_AMOUNT_LIMIT = 2 * 1024 * 1024;
const SSH_OUTPUT_BACKPRESSURE_RETRY_MS = 16;
const SSH_OUTPUT_BATCH_WINDOW_MS = 16;
const INTERACTIVE_SSH_OUTPUT_FLUSH_BYTES = 1024;

function pauseSshOutput(state: ClientState): void {
    if (state.isSshOutputPaused || !state.sshShellStream) return;
    state.sshShellStream.pause();
    state.isSshOutputPaused = true;
}

function resumeSshOutput(state: ClientState): void {
    if (!state.isSshOutputPaused || !state.sshShellStream) return;
    state.sshShellStream.resume();
    state.isSshOutputPaused = false;
}

function clearScheduledSshOutputFlush(state: ClientState): void {
    if (state.sshOutputFlushTimer) {
        clearTimeout(state.sshOutputFlushTimer);
        state.sshOutputFlushTimer = undefined;
    }
}

function scheduleDelayedFlush(state: ClientState): void {
    if (state.sshOutputFlushTimer || state.ws.readyState !== WebSocket.OPEN) return;
    state.sshOutputFlushTimer = setTimeout(() => {
        state.sshOutputFlushTimer = undefined;
        flushSshOutput(state);
    }, SSH_OUTPUT_BACKPRESSURE_RETRY_MS);
}

function sendSshOutputFrame(state: ClientState, output: Buffer, options: { compress?: boolean } = {}): void {
    if (state.ws.readyState !== WebSocket.OPEN || output.byteLength === 0) return;

    if (state.supportsSshBinaryOutput) {
        state.ws.send(encodeSshOutputFrame(output, true), options);
        return;
    }

    state.ws.send(encodeSshOutputFrame(output, false), options);
}

function sendSshOutputChunks(state: ClientState, chunkList: Buffer[], outputBytes: number): void {
    if (chunkList.length === 1) {
        const chunk = chunkList[0];
        if (chunk.byteLength <= MAX_SSH_OUTPUT_FRAME_BYTES) {
            sendSshOutputFrame(state, chunk, { compress: false });
            return;
        }
    }

    const output = chunkList.length === 1 ? chunkList[0] : Buffer.concat(chunkList, outputBytes);
    for (let offset = 0; offset < output.byteLength; offset += MAX_SSH_OUTPUT_FRAME_BYTES) {
        sendSshOutputFrame(state, output.subarray(offset, offset + MAX_SSH_OUTPUT_FRAME_BYTES), { compress: false });
    }
}

export function flushSshOutput(state: ClientState, options: { force?: boolean } = {}): void {
    state.isSshOutputMicrotaskScheduled = false;
    clearScheduledSshOutputFlush(state);

    if (state.ws.readyState !== WebSocket.OPEN) {
        state.pendingSshOutputBuffer = undefined;
        state.pendingSshOutputBytes = 0;
        resumeSshOutput(state);
        return;
    }

    if (!options.force && state.ws.bufferedAmount > SSH_OUTPUT_BUFFERED_AMOUNT_LIMIT) {
        pauseSshOutput(state);
        scheduleDelayedFlush(state);
        return;
    }

    const chunkList = state.pendingSshOutputBuffer;
    const outputBytes = state.pendingSshOutputBytes ?? 0;
    state.pendingSshOutputBuffer = undefined;
    state.pendingSshOutputBytes = 0;

    if (!chunkList?.length) {
        resumeSshOutput(state);
        return;
    }

    sendSshOutputChunks(state, chunkList, outputBytes);

    if (!options.force && state.ws.bufferedAmount > SSH_OUTPUT_BUFFERED_AMOUNT_LIMIT) {
        pauseSshOutput(state);
        scheduleDelayedFlush(state);
        return;
    }

    resumeSshOutput(state);
}

export function scheduleSshOutput(state: ClientState, data: Buffer): void {
    if (state.ws.readyState !== WebSocket.OPEN) return;

    if (!state.pendingSshOutputBuffer) {
        state.pendingSshOutputBuffer = [];
        state.pendingSshOutputBytes = 0;
    }
    state.pendingSshOutputBuffer.push(data);
    state.pendingSshOutputBytes = (state.pendingSshOutputBytes ?? 0) + data.byteLength;

    if ((state.pendingSshOutputBytes ?? 0) > MAX_PENDING_SSH_OUTPUT_BYTES) {
        pauseSshOutput(state);
    }

    if (state.sshOutputFlushTimer) return;
    if ((state.pendingSshOutputBytes ?? 0) <= INTERACTIVE_SSH_OUTPUT_FLUSH_BYTES) {
        if (state.isSshOutputMicrotaskScheduled) return;
        state.isSshOutputMicrotaskScheduled = true;
        queueMicrotask(() => flushSshOutput(state));
        return;
    }

    state.sshOutputFlushTimer = setTimeout(() => flushSshOutput(state), SSH_OUTPUT_BATCH_WINDOW_MS);
}

export function clearSshOutputQueue(state: ClientState): void {
    clearScheduledSshOutputFlush(state);
    state.isSshOutputMicrotaskScheduled = false;
    state.pendingSshOutputBuffer = undefined;
    state.pendingSshOutputBytes = 0;
    resumeSshOutput(state);
}

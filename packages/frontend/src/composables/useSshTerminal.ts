import { ref, readonly, watch, type Ref, ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { sessions as globalSessionsRef, poppedOutSessionIds } from '../stores/session/state'; // +++ 导入全局 sessions state +++
// import { useWebSocketConnection } from './useWebSocketConnection'; // 移除全局导入
import type { Terminal } from '@xterm/xterm';
import type { SearchAddon, ISearchOptions } from '@xterm/addon-search'; // *** 移除 ISearchResult 导入 ***
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types';
import type { SshOutputHandler } from './useWebSocketConnection';
import { debugLog } from './useDebugLog';
import { useSettingsStore } from '../stores/settings.store';
import { createTerminalRenderHighlighter } from '../utils/terminalRenderHighlighter';
import {
    consumeLocalEchoFromOutput,
    createTerminalLocalEchoState,
    hasPendingLocalEcho,
    recordLocalEcho,
    rememberTerminalOutputText,
    resetTerminalLocalEcho,
    resolveLocalEchoText,
} from '../utils/terminalLocalEcho';

// 定义与 WebSocket 相关的依赖接口
export interface SshTerminalDependencies {
    sendMessage: (message: WebSocketMessage) => void;
    sendSshInput?: (targetSessionId: string, data: string) => void;
    sendTelnetInput?: (targetSessionId: string, data: string) => void;
    onMessage: (type: string, handler: (payload: any, fullMessage?: WebSocketMessage) => void) => () => void;
    onSshOutput?: (handler: SshOutputHandler) => () => void;
    isConnected: ComputedRef<boolean>;
}

/**
 * 创建一个 SSH 终端管理器实例
 * @param sessionId 会话唯一标识符
 * @param wsDeps WebSocket 依赖对象
 * @param t i18n 翻译函数，从父组件传入
 * @returns SSH 终端管理器实例
 */
export function createSshTerminalManager(sessionId: string, wsDeps: SshTerminalDependencies, t: ReturnType<typeof useI18n>['t'], options: { protocol?: 'ssh' | 'telnet' } = {}) { // +++ Update type of t +++
    // 使用依赖注入的 WebSocket 函数
    const { sendMessage, sendSshInput, sendTelnetInput, onMessage, onSshOutput, isConnected } = wsDeps;
    const protocol = options.protocol ?? 'ssh';
    const settingsStore = useSettingsStore();
    const { terminalHighlightEnabledBoolean, terminalHighlightRulesList } = storeToRefs(settingsStore);

    const terminalInstance = ref<Terminal | null>(null);
    const searchAddon = ref<SearchAddon | null>(null); // Keep searchAddon ref
    let ensureSearchAddonLoaded: (() => SearchAddon | null) | null = null;
    // Removed search result state refs
    // const searchResultCount = ref(0);
    // const currentSearchResultIndex = ref(-1);
    const terminalOutputBuffer: (string | Uint8Array)[] = []; // 缓冲 WebSocket 消息直到终端准备好
    const isSshConnected = ref(false); // 跟踪 SSH 连接状态
    const pendingInputBuffer: string[] = [];
    const pendingOutputBuffer: (string | Uint8Array)[] = [];
    let pendingOutputHeadIndex = 0;
    let inputFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let outputFlushFrame: number | null = null;
    let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let outputIdleFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let outputFlushMicrotaskScheduled = false;
    let isOutputWriteInProgress = false;
    let pendingOutputBytes = 0;
    const pendingBase64OutputQueue: { base64String: string; message?: WebSocketMessage }[] = [];
    let pendingBase64OutputHeadIndex = 0;
    let outputDecodeFrame: number | null = null;
    let outputDecodeTimer: ReturnType<typeof setTimeout> | null = null;
    let outputDecodeWindow: Window | null = null;
    let outputDecodeMicrotaskScheduled = false;
    const terminalHighlightTextDecoder = new TextDecoder();
    const terminalLocalEchoState = createTerminalLocalEchoState();
    const terminalPerformanceStats = {
        localEchoCount: 0,
        inputSendCount: 0,
        outputWriteCount: 0,
        slowOutputWriteCount: 0,
        lastOutputWriteMs: 0,
        maxOutputWriteMs: 0,
        outputFrameBudgetBytes: 64 * 1024,
    };
    const INPUT_FLUSH_DELAY = 8;
    const OUTPUT_FLUSH_FALLBACK_DELAY = 32;
    const OUTPUT_IDLE_FLUSH_DELAY = 48;
    const INTERACTIVE_OUTPUT_FLUSH_LIMIT = 512;
    // xterm 的 VT 解析和 DOM 行创建都运行在主线程。严格限制每帧输入，
    // 不能因为一批数据“尚未超过预算”就把几十 KB 日志一次写入而卡住页面。
    const OUTPUT_FRAME_BUDGET_MIN_BYTES = 16 * 1024;
    const OUTPUT_FRAME_BUDGET_DEFAULT_BYTES = 64 * 1024;
    const OUTPUT_FRAME_BUDGET_MAX_BYTES = 128 * 1024;
    const OUTPUT_QUEUE_CHUNK_BYTES = 16 * 1024;
    const OUTPUT_FRAME_BUDGET_CHUNKS = 16;
    let outputFrameBudgetBytes = OUTPUT_FRAME_BUDGET_DEFAULT_BYTES;
    const INTERACTIVE_BASE64_DECODE_LENGTH = 4 * 1024;
    const OUTPUT_DECODE_FRAME_BUDGET_BYTES = 256 * 1024;
    const OUTPUT_DECODE_FRAME_CHUNKS = 32;

    // 辅助函数：获取终端消息文本
    const getTerminalText = (key: string, params?: Record<string, any>): string => {
        // 确保 i18n key 存在，否则返回原始 key
        const translationKey = `workspace.terminal.${key}`;
        const translated = t(translationKey, params || {});
        return translated === translationKey ? key : translated;
    };

    const readTerminalMessageText = (payload: MessagePayload, fallback: string): string => {
        if (typeof payload === 'string') return payload;
        if (payload && typeof payload === 'object') {
            const payloadRecord = payload as Record<string, unknown>;
            const message = payloadRecord.message ?? payloadRecord.error ?? payloadRecord.reason;
            if (typeof message === 'string' && message.length > 0) return message;
        }
        return fallback;
    };

    const isPoppedOut = () => poppedOutSessionIds.value.includes(sessionId);

    const getTerminalWindow = (term: Terminal) => term.element?.ownerDocument.defaultView ?? window;

    const refreshTerminalAfterPoppedOutWrite = (term: Terminal) => {
        try {
            const terminalWindow = term.element?.ownerDocument.defaultView;
            const refresh = () => term.refresh(0, Math.max(term.rows - 1, 0));
            if (terminalWindow && !terminalWindow.closed) {
                terminalWindow.requestAnimationFrame(refresh);
            } else {
                refresh();
            }
        } catch (error) {
            console.warn(`[会话 ${sessionId}][SSH终端模块] 弹出终端刷新失败:`, error);
        }
    };

    const writeTerminalOutput = (term: Terminal, data: string | Uint8Array, callback?: () => void) => {
        if (!isPoppedOut()) {
            term.write(data, callback);
            return;
        }

        term.write(data, () => {
            refreshTerminalAfterPoppedOutWrite(term);
            callback?.();
        });
    };

    const getOutputLength = (data: string | Uint8Array) => typeof data === 'string' ? data.length : data.byteLength;

    const updateOutputFrameBudget = (nextBudgetBytes: number) => {
        outputFrameBudgetBytes = Math.min(
            OUTPUT_FRAME_BUDGET_MAX_BYTES,
            Math.max(OUTPUT_FRAME_BUDGET_MIN_BYTES, Math.round(nextBudgetBytes)),
        );
        terminalPerformanceStats.outputFrameBudgetBytes = outputFrameBudgetBytes;
    };

    const adjustOutputFrameBudget = (durationMs: number, writtenBytes: number) => {
        if (writtenBytes < INTERACTIVE_OUTPUT_FLUSH_LIMIT) return;

        if (durationMs > 80 && outputFrameBudgetBytes > OUTPUT_FRAME_BUDGET_MIN_BYTES) {
            updateOutputFrameBudget(outputFrameBudgetBytes / 2);
            return;
        }

        if (
            durationMs < 16
            && pendingOutputBytes > outputFrameBudgetBytes * 2
            && outputFrameBudgetBytes < OUTPUT_FRAME_BUDGET_MAX_BYTES
        ) {
            updateOutputFrameBudget(outputFrameBudgetBytes * 2);
        }
    };

    const writeLocalEcho = (data: string) => {
        const term = terminalInstance.value;
        if (!term || !data) return;

        terminalPerformanceStats.localEchoCount += 1;
        writeTerminalOutput(term, data);
    };

    const getTerminalHighlightOptions = () => ({
        enabled: terminalHighlightEnabledBoolean.value,
        rules: terminalHighlightRulesList.value,
    });
    const terminalRenderHighlighter = createTerminalRenderHighlighter(getTerminalHighlightOptions);
    const stopTerminalHighlightWatcher = watch(
        [terminalHighlightEnabledBoolean, terminalHighlightRulesList],
        () => {
            terminalRenderHighlighter.invalidate();
            const term = terminalInstance.value;
            if (term) {
                term.refresh(0, Math.max(term.rows - 1, 0));
            }
        },
    );

    // PTY 文本必须原样交给 xterm。高亮只在 xterm 创建可见行时以临时
    // 渲染属性提供，不能在此处插入 ANSI 或阻塞输出。
    const cancelOutputIdleFlush = () => {
        if (outputIdleFlushTimer !== null) {
            clearTimeout(outputIdleFlushTimer);
            outputIdleFlushTimer = null;
        }
    };

    const writeOutputBatch = (term: Terminal, chunkList: (string | Uint8Array)[]) => new Promise<void>(resolve => {
        if (chunkList.length === 0) return resolve();
        const startedAt = performance.now();
        const writtenBytes = chunkList.reduce((total, chunk) => total + getOutputLength(chunk), 0);
        // Queue multiple medium chunks synchronously. xterm's WriteBuffer then
        // parses them within its own 12ms deadline and coalesces redraws. Awaiting
        // every chunk here used to force one redundant viewport render per 8KB.
        chunkList.forEach((chunk, index) => {
            writeTerminalOutput(term, chunk, index === chunkList.length - 1 ? () => {
                const durationMs = performance.now() - startedAt;
                terminalPerformanceStats.outputWriteCount += chunkList.length;
                terminalPerformanceStats.lastOutputWriteMs = durationMs;
                terminalPerformanceStats.maxOutputWriteMs = Math.max(terminalPerformanceStats.maxOutputWriteMs, durationMs);
                if (durationMs > 48) terminalPerformanceStats.slowOutputWriteCount += 1;
                adjustOutputFrameBudget(durationMs, writtenBytes);
                resolve();
            } : undefined);
        });
    });

    const compactPendingOutputBufferIfNeeded = () => {
        if (pendingOutputHeadIndex === 0) return;
        if (pendingOutputHeadIndex >= pendingOutputBuffer.length) {
            pendingOutputBuffer.length = 0;
            pendingOutputHeadIndex = 0;
            return;
        }

        if (pendingOutputHeadIndex < 128 && pendingOutputHeadIndex * 2 < pendingOutputBuffer.length) return;

        pendingOutputBuffer.splice(0, pendingOutputHeadIndex);
        pendingOutputHeadIndex = 0;
    };

    const getPendingOutputChunkCount = () => pendingOutputBuffer.length - pendingOutputHeadIndex;

    const takeOutputBatch = (shouldLimitBatch: boolean) => {
        const pendingChunkCount = getPendingOutputChunkCount();
        if (pendingChunkCount <= 0) {
            pendingOutputBytes = 0;
            compactPendingOutputBufferIfNeeded();
            return [];
        }

        let batchCount = pendingChunkCount;
        let byteCount = pendingOutputBytes;

        if (shouldLimitBatch) {
            batchCount = 0;
            byteCount = 0;
            while (batchCount < pendingChunkCount && batchCount < OUTPUT_FRAME_BUDGET_CHUNKS) {
                const nextLength = getOutputLength(pendingOutputBuffer[pendingOutputHeadIndex + batchCount]);
                if (batchCount > 0 && byteCount + nextLength > outputFrameBudgetBytes) break;
                byteCount += nextLength;
                batchCount += 1;
                if (byteCount >= outputFrameBudgetBytes) break;
            }
        }

        const chunkList = pendingOutputBuffer.slice(pendingOutputHeadIndex, pendingOutputHeadIndex + batchCount);
        pendingOutputHeadIndex += batchCount;
        pendingOutputBytes = shouldLimitBatch ? Math.max(0, pendingOutputBytes - byteCount) : 0;
        compactPendingOutputBufferIfNeeded();
        return chunkList;
    };

    const enqueueTerminalOutput = (data: string | Uint8Array) => {
        const outputLength = getOutputLength(data);
        if (outputLength <= OUTPUT_QUEUE_CHUNK_BYTES) {
            pendingOutputBuffer.push(data);
            pendingOutputBytes += outputLength;
            return outputLength;
        }

        for (let offset = 0; offset < outputLength; offset += OUTPUT_QUEUE_CHUNK_BYTES) {
            const nextChunk = data.slice(offset, offset + OUTPUT_QUEUE_CHUNK_BYTES);
            pendingOutputBuffer.push(nextChunk);
        }
        pendingOutputBytes += outputLength;
        return outputLength;
    };

    const scheduleOutputFrameFlush = () => {
        const term = terminalInstance.value;
        if (!term || outputFlushFrame !== null || outputFlushTimer !== null) return;

        const terminalWindow = getTerminalWindow(term);
        outputFlushFrame = terminalWindow.requestAnimationFrame(() => { void flushTerminalOutput('frame'); });
        outputFlushTimer = setTimeout(() => { void flushTerminalOutput('timer'); }, OUTPUT_FLUSH_FALLBACK_DELAY);
    };

    const scheduleOutputIdleFlush = () => {
        if (!terminalInstance.value || outputIdleFlushTimer !== null) return;

        outputIdleFlushTimer = setTimeout(() => {
            outputIdleFlushTimer = null;
            void flushTerminalOutput('idle');
        }, OUTPUT_IDLE_FLUSH_DELAY);
    };

    async function flushTerminalOutput(source: 'microtask' | 'frame' | 'timer' | 'idle' = 'microtask') {
        outputFlushMicrotaskScheduled = false;
        const term = terminalInstance.value;

        if (outputFlushFrame !== null && term) {
            getTerminalWindow(term).cancelAnimationFrame(outputFlushFrame);
        }
        outputFlushFrame = null;
        if (outputFlushTimer !== null) {
            clearTimeout(outputFlushTimer);
            outputFlushTimer = null;
        }
        if (source !== 'idle') {
            cancelOutputIdleFlush();
        }

        if (isOutputWriteInProgress) return;
        if (!term || getPendingOutputChunkCount() === 0) return;

        if (source === 'microtask' && pendingOutputBytes > INTERACTIVE_OUTPUT_FLUSH_LIMIT) {
            scheduleOutputFrameFlush();
            return;
        }

        // 非交互输出始终按预算切分。此前只在累计待处理量超过预算时才切分，
        // 会让 8~64KB 的单批日志直接阻塞一次 xterm.write。
        const shouldLimitBatch = source !== 'microtask';
        const chunkList = takeOutputBatch(shouldLimitBatch);
        if (chunkList.length === 0) return;

        isOutputWriteInProgress = true;
        try {
            if (chunkList.length > 0) {
                await writeOutputBatch(term, chunkList);
            }
        } finally {
            isOutputWriteInProgress = false;
        }

        if (terminalInstance.value !== term) return;
        if (getPendingOutputChunkCount() > 0) {
            scheduleOutputFrameFlush();
        }
    }

    const scheduleTerminalOutput = (data: string | Uint8Array) => {
        cancelOutputIdleFlush();
        const outputLength = enqueueTerminalOutput(data);
        if (!terminalInstance.value || isOutputWriteInProgress || outputFlushFrame !== null || outputFlushTimer !== null) return;

        if (pendingOutputBytes > INTERACTIVE_OUTPUT_FLUSH_LIMIT || outputLength > INTERACTIVE_OUTPUT_FLUSH_LIMIT) {
            scheduleOutputFrameFlush();
            return;
        }

        if (outputFlushMicrotaskScheduled) return;
        outputFlushMicrotaskScheduled = true;
        queueMicrotask(() => { void flushTerminalOutput('microtask'); });
    };

    const sendSshInputData = (data: string) => {
        if (protocol === 'telnet') {
            if (sendTelnetInput) {
                sendTelnetInput(sessionId, data);
            } else {
                sendMessage({ type: 'telnet:input', payload: { sessionId, data: btoa(data) } });
            }
            return;
        }
        if (sendSshInput) {
            sendSshInput(sessionId, data);
            return;
        }

        sendMessage({ type: 'ssh:input', sessionId, payload: { data } });
    };

    const flushPendingInput = () => {
        if (inputFlushTimer !== null) {
            clearTimeout(inputFlushTimer);
            inputFlushTimer = null;
        }
        if (pendingInputBuffer.length === 0) return;

        const data = pendingInputBuffer.join('');
        pendingInputBuffer.length = 0;
        terminalPerformanceStats.inputSendCount += 1;
        sendSshInputData(data);
    };

    const scheduleTerminalInput = (data: string, options: { forceBuffer?: boolean } = {}) => {
        if (!data) return;

        if (!options.forceBuffer) {
            flushPendingInput();
            terminalPerformanceStats.inputSendCount += 1;
            sendSshInputData(data);
            return;
        }

        pendingInputBuffer.push(data);
        if (inputFlushTimer !== null) return;

        inputFlushTimer = setTimeout(flushPendingInput, INPUT_FLUSH_DELAY);
    };

    const echoLocalInputIfNeeded = (data: string) => {
        if (protocol !== 'ssh') return;

        const localEchoText = resolveLocalEchoText(data, terminalLocalEchoState);
        if (!localEchoText) return;

        writeLocalEcho(localEchoText);
        recordLocalEcho(localEchoText, terminalLocalEchoState);
    };

    const decodeBase64Output = (base64String: string): Uint8Array => {
        const binaryString = atob(base64String);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    };

    const scheduleTerminalByteOutput = (bytes: Uint8Array) => {
        if (!hasPendingLocalEcho(terminalLocalEchoState)) {
            scheduleTerminalOutput(bytes);
            return;
        }

        const decodedText = terminalHighlightTextDecoder.decode(bytes, { stream: true });
        const text = consumeLocalEchoFromOutput(decodedText, terminalLocalEchoState);
        if (text.length > 0) {
            scheduleTerminalOutput(text);
        }
    };

    const compactPendingBase64OutputQueueIfNeeded = () => {
        if (pendingBase64OutputHeadIndex === 0) return;
        if (pendingBase64OutputHeadIndex >= pendingBase64OutputQueue.length) {
            pendingBase64OutputQueue.length = 0;
            pendingBase64OutputHeadIndex = 0;
            return;
        }

        if (pendingBase64OutputHeadIndex < 128 && pendingBase64OutputHeadIndex * 2 < pendingBase64OutputQueue.length) return;

        pendingBase64OutputQueue.splice(0, pendingBase64OutputHeadIndex);
        pendingBase64OutputHeadIndex = 0;
    };

    const getPendingBase64OutputCount = () => pendingBase64OutputQueue.length - pendingBase64OutputHeadIndex;

    const cancelScheduledOutputDecode = () => {
        if (outputDecodeFrame !== null && outputDecodeWindow) {
            outputDecodeWindow.cancelAnimationFrame(outputDecodeFrame);
        }
        outputDecodeFrame = null;
        outputDecodeWindow = null;
        if (outputDecodeTimer !== null) {
            clearTimeout(outputDecodeTimer);
            outputDecodeTimer = null;
        }
    };

    const processOutputDecodeBatch = (maxChunks: number, maxBytes: number) => {
        cancelScheduledOutputDecode();
        outputDecodeMicrotaskScheduled = false;

        let decodedBytes = 0;
        let decodedChunks = 0;
        while (decodedChunks < maxChunks) {
            const next = pendingBase64OutputQueue[pendingBase64OutputHeadIndex];
            if (!next) break;

            // Base64 的有效载荷大小约为字符串长度的 3/4，用它限制单帧工作量。
            const estimatedBytes = Math.floor(next.base64String.length * 3 / 4);
            if (decodedChunks > 0 && decodedBytes + estimatedBytes > maxBytes) break;
            pendingBase64OutputHeadIndex += 1;

            try {
                scheduleTerminalByteOutput(decodeBase64Output(next.base64String));
            } catch (e) {
                console.error(`[会话 ${sessionId}][SSH终端模块] Base64 解码失败:`, e, '原始数据:', next.message?.payload);
                scheduleTerminalOutput(`\r\n[解码错误: ${e}]\r\n`);
            }
            decodedBytes += estimatedBytes;
            decodedChunks += 1;
        }

        compactPendingBase64OutputQueueIfNeeded();
        if (getPendingBase64OutputCount() > 0) {
            scheduleOutputDecodeFrame();
        }
    };

    const scheduleOutputDecodeFrame = () => {
        if (getPendingBase64OutputCount() === 0 || outputDecodeFrame !== null || outputDecodeTimer !== null) return;
        outputDecodeWindow = terminalInstance.value ? getTerminalWindow(terminalInstance.value) : window;
        outputDecodeFrame = outputDecodeWindow.requestAnimationFrame(() => {
            processOutputDecodeBatch(OUTPUT_DECODE_FRAME_CHUNKS, OUTPUT_DECODE_FRAME_BUDGET_BYTES);
        });
        outputDecodeTimer = setTimeout(() => {
            processOutputDecodeBatch(OUTPUT_DECODE_FRAME_CHUNKS, OUTPUT_DECODE_FRAME_BUDGET_BYTES);
        }, OUTPUT_FLUSH_FALLBACK_DELAY);
    };

    function scheduleOutputDecodeDrain() {
        if (getPendingBase64OutputCount() === 0 || outputDecodeFrame !== null || outputDecodeTimer !== null || outputDecodeMicrotaskScheduled) return;

        const next = pendingBase64OutputQueue[pendingBase64OutputHeadIndex];
        if (!next) return;
        if (getPendingBase64OutputCount() > 1 || next.base64String.length > INTERACTIVE_BASE64_DECODE_LENGTH) {
            scheduleOutputDecodeFrame();
            return;
        }

        // 单个极小响应仍可立即显示；批量输出绝不递归占满微任务队列。
        outputDecodeMicrotaskScheduled = true;
        queueMicrotask(() => processOutputDecodeBatch(1, INTERACTIVE_BASE64_DECODE_LENGTH));
    }

    const scheduleOutputDecode = (base64String: string, message?: WebSocketMessage) => {
        pendingBase64OutputQueue.push({ base64String, message });
        scheduleOutputDecodeDrain();
    };

    const writelnTerminalOutput = (term: Terminal, data: string | Uint8Array) => {
        writeTerminalOutput(term, data);
        writeTerminalOutput(term, '\r\n');
    };

    // --- 终端事件处理 ---

    // *** 更新 handleTerminalReady 签名以接收 searchAddon ***
    const handleTerminalReady = (payload: { terminal: Terminal; searchAddon?: SearchAddon | null; ensureSearchAddonLoaded?: () => SearchAddon | null }) => {
        const { terminal: term, searchAddon: addon } = payload;
        debugLog(`[会话 ${sessionId}][SSH终端模块] 终端实例已就绪。SearchAddon 实例:`, addon ? '存在' : '按需加载');
        terminalInstance.value = term;
        if (!terminalRenderHighlighter.attach(term)) {
            console.warn(`[会话 ${sessionId}][SSH终端模块] 当前 xterm 渲染器不支持行级高亮，已保留原始终端输出。`);
        }
        searchAddon.value = addon ?? null; // *** 存储 searchAddon 实例 ***
        ensureSearchAddonLoaded = payload.ensureSearchAddonLoaded ?? null;

        
        // 1. 处理 SessionState.pendingOutput (来自 SSH_OUTPUT_CACHED_CHUNK 的早期数据)
        const currentSessionState = globalSessionsRef.value.get(sessionId);
        if (currentSessionState && currentSessionState.pendingOutput && currentSessionState.pendingOutput.length > 0) {
            // console.log(`[会话 ${sessionId}][SSH终端模块] 发现 SessionState.pendingOutput，长度: ${currentSessionState.pendingOutput.length}。正在写入...`);
            currentSessionState.pendingOutput.forEach(data => {
                scheduleTerminalOutput(data);
            });
            currentSessionState.pendingOutput = []; // 清空
            // console.log(`[会话 ${sessionId}][SSH终端模块] SessionState.pendingOutput 处理完毕。`);
            // 如果之前因为 pendingOutput 而将 isResuming 保持为 true，现在可以考虑更新
            if (currentSessionState.isResuming) {
                // 检查 isLastChunk 是否已收到 (这部分逻辑在 handleSshOutputCachedChunk 中，这里仅作标记清除)
                // 假设所有缓存块都已处理完毕
                // console.log(`[会话 ${sessionId}][SSH终端模块] 所有 pendingOutput 已写入，清除 isResuming 标记。`);
                currentSessionState.isResuming = false;
            }
        }

        // 2. 将此管理器内部缓冲的输出 (terminalOutputBuffer, 来自 ssh:output) 写入终端
        if (terminalOutputBuffer.length > 0) {
            terminalOutputBuffer.forEach(data => {
                 scheduleTerminalOutput(data);
            });
            terminalOutputBuffer.length = 0; // 清空内部缓冲区
        }

        if (getPendingOutputChunkCount() > 0) {
            void flushTerminalOutput('frame');
        }
        
        // 可以在这里自动聚焦或执行其他初始化操作
        // term.focus(); // 也许在 ssh:connected 时聚焦更好
    };

    const handleTerminalData = (data: string, options: { batched?: boolean; localEcho?: boolean } = {}) => {
        // console.debug(`[会话 ${sessionId}][SSH终端模块] 接收到终端输入:`, data);
        if (options.localEcho !== false) {
            echoLocalInputIfNeeded(data);
        }
        if (options.batched) {
            flushPendingInput();
            sendSshInputData(data);
            return;
        }

        scheduleTerminalInput(data);
    };

    const handleTerminalResize = (dimensions: { cols: number; rows: number }) => {
        debugLog(`[SSH ${sessionId}] handleTerminalResize called with:`, dimensions);
        // 只有在连接状态下才发送 resize 命令给后端
        if (isConnected.value) {
            sendMessage({
                type: protocol === 'telnet' ? 'telnet:resize' : 'ssh:resize',
                ...(protocol === 'ssh' ? { sessionId } : {}),
                payload: protocol === 'telnet' ? { sessionId, ...dimensions } : dimensions,
            });
        } else {
            debugLog(`[SSH ${sessionId}] WebSocket not connected, skipping ssh:resize.`);
        }
    };

    // --- WebSocket 消息处理 ---

    const handleSshOutputData = (payload: MessagePayload, encoding?: 'binary' | 'base64', message?: WebSocketMessage) => {
        if (message?.sessionId && message.sessionId !== sessionId) {
            return;
        }

        let outputData = payload;
        if (encoding === 'binary' && outputData instanceof Uint8Array) {
            scheduleTerminalByteOutput(outputData);
            return;
        }

        if (encoding === 'base64' && typeof outputData === 'string') {
            scheduleOutputDecode(outputData, message);
            return;
        }

        if (typeof outputData !== 'string') {
             console.warn(`[会话 ${sessionId}][SSH终端模块] 收到非字符串 ssh:output payload:`, outputData);
             try {
                 outputData = JSON.stringify(outputData);
             } catch {
                 outputData = String(outputData);
             }
        }

        outputData = consumeLocalEchoFromOutput(outputData, terminalLocalEchoState);
        if (!outputData) return;

        if (terminalInstance.value) {
            scheduleTerminalOutput(outputData);
        } else {
            terminalOutputBuffer.push(outputData);
        }
    };

    const handleSshOutput = (payload: MessagePayload, message?: WebSocketMessage) => {
        handleSshOutputData(payload, message?.encoding, message);
    };

    const handleSshConnected = (payload: MessagePayload, message?: WebSocketMessage) => {
        // 检查消息是否属于此会话
        if (message?.sessionId && message.sessionId !== sessionId) {
            return; // 忽略不属于此会话的消息
        }

        debugLog(`[会话 ${sessionId}][SSH终端模块] SSH 会话已连接。 Payload:`, payload, 'Full message:', message);
        isSshConnected.value = true; // 更新状态
        // 连接成功后聚焦终端
        terminalInstance.value?.focus();

        if (terminalInstance.value) {
            const currentDimensions = { cols: terminalInstance.value.cols, rows: terminalInstance.value.rows };
            // 检查尺寸是否有效
            if (currentDimensions.cols > 0 && currentDimensions.rows > 0) {
                debugLog(`[会话 ${sessionId}][SSH终端模块] SSH 连接成功，主动发送初始尺寸:`, currentDimensions);
                sendMessage({ type: 'ssh:resize', sessionId, payload: currentDimensions });
            } else {
                console.warn(`[会话 ${sessionId}][SSH终端模块] SSH 连接成功，但获取到的初始尺寸无效，跳过发送 resize:`, currentDimensions);
            }
        } else {
             console.warn(`[会话 ${sessionId}][SSH终端模块] SSH 连接成功，但 terminalInstance 不可用，无法发送初始 resize。`);
        }


        // 清空可能存在的旧缓冲（虽然理论上此时应该已经 ready 了）
        if (terminalOutputBuffer.length > 0) {
             console.warn(`[会话 ${sessionId}][SSH终端模块] SSH 连接时仍有缓冲数据，正在写入...`);
             terminalOutputBuffer.forEach(data => {
                 if (terminalInstance.value) {
                     scheduleTerminalOutput(data);
                 }
             });
             terminalOutputBuffer.length = 0;
        }
    };

    const handleSshDisconnected = (payload: MessagePayload, message?: WebSocketMessage) => {
        // 检查消息是否属于此会话
        if (message?.sessionId && message.sessionId !== sessionId) {
            return; // 忽略不属于此会话的消息
        }

        const reason = readTerminalMessageText(payload, t('workspace.terminal.unknownReason')); // 使用 i18n 获取未知原因文本
        debugLog(`[会话 ${sessionId}][SSH终端模块] SSH 会话已断开:`, reason);
        isSshConnected.value = false; // 更新状态
        if (terminalInstance.value) {
            writelnTerminalOutput(terminalInstance.value, `\r\n\x1b[31m${getTerminalText('disconnectMsg', { reason })}\x1b[0m`);
        }
        // 可以在这里添加其他清理逻辑，例如禁用输入
    };

    const handleSshError = (payload: MessagePayload, message?: WebSocketMessage) => {
        // 检查消息是否属于此会话
        if (message?.sessionId && message.sessionId !== sessionId) {
            return; // 忽略不属于此会话的消息
        }

        const errorMsg = readTerminalMessageText(payload, t('workspace.terminal.unknownSshError')); // 使用 i18n
        console.error(`[会话 ${sessionId}][SSH终端模块] SSH 错误:`, errorMsg);
        isSshConnected.value = false; // 更新状态
        if (terminalInstance.value) {
            writelnTerminalOutput(terminalInstance.value, `\r\n\x1b[31m${getTerminalText('genericErrorMsg', { message: errorMsg })}\x1b[0m`);
        }
    };

    const handleSshStatus = (payload: MessagePayload, message?: WebSocketMessage) => {
        // 检查消息是否属于此会话
        if (message?.sessionId && message.sessionId !== sessionId) {
            return; // 忽略不属于此会话的消息
        }

        // 这个消息现在由 useWebSocketConnection 处理以更新全局状态栏消息
        // 这里可以保留日志或用于其他特定于终端的 UI 更新（如果需要）
        const statusKey = payload?.key || 'unknown';
        const statusParams = payload?.params || {};
        if (typeof payload === 'string') {
            rememberTerminalOutputText(payload, terminalLocalEchoState);
        }
        debugLog(`[会话 ${sessionId}][SSH终端模块] 收到 SSH 状态更新:`, statusKey, statusParams);
        // 可以在终端打印一些状态信息吗？
        // terminalInstance.value?.writeln(`\r\n\x1b[34m[状态: ${statusKey}]\x1b[0m`);
    };

    const handleInfoMessage = (payload: MessagePayload, message?: WebSocketMessage) => {
        // 检查消息是否属于此会话
        if (message?.sessionId && message.sessionId !== sessionId) {
            return; // 忽略不属于此会话的消息
        }

        debugLog(`[会话 ${sessionId}][SSH终端模块] 收到后端信息:`, payload);
        if (terminalInstance.value) {
            writelnTerminalOutput(terminalInstance.value, `\r\n\x1b[34m${getTerminalText('infoPrefix')} ${payload}\x1b[0m`);
        }
    };

    const handleErrorMessage = (payload: MessagePayload, message?: WebSocketMessage) => {
        // 检查消息是否属于此会话
        if (message?.sessionId && message.sessionId !== sessionId) {
            return; // 忽略不属于此会话的消息
        }

        // 通用错误也可能需要显示在终端
        const errorMsg = readTerminalMessageText(payload, t('workspace.terminal.unknownGenericError')); // 使用 i18n
        console.error(`[会话 ${sessionId}][SSH终端模块] 收到后端通用错误:`, errorMsg);
        if (terminalInstance.value) {
            writelnTerminalOutput(terminalInstance.value, `\r\n\x1b[31m${getTerminalText('errorPrefix')} ${errorMsg}\x1b[0m`);
        }
    };


    // --- 注册 WebSocket 消息处理器 ---
    const unregisterHandlers: (() => void)[] = [];

    const registerSshHandlers = () => {
        if (onSshOutput) {
            unregisterHandlers.push(onSshOutput((payload, encoding, message) => handleSshOutputData(payload, encoding, message)));
        } else {
            unregisterHandlers.push(onMessage('ssh:output', handleSshOutput));
        }
        unregisterHandlers.push(onMessage('ssh:connected', handleSshConnected));
        unregisterHandlers.push(onMessage('ssh:disconnected', handleSshDisconnected));
        unregisterHandlers.push(onMessage('ssh:error', handleSshError));
        unregisterHandlers.push(onMessage('ssh:status', handleSshStatus));
        unregisterHandlers.push(onMessage('telnet:output', handleSshOutput));
        unregisterHandlers.push(onMessage('telnet:connected', handleSshConnected));
        unregisterHandlers.push(onMessage('telnet:disconnected', handleSshDisconnected));
        unregisterHandlers.push(onMessage('telnet:error', handleSshError));
        unregisterHandlers.push(onMessage('info', handleInfoMessage));
        unregisterHandlers.push(onMessage('error', handleErrorMessage)); // 也处理通用错误
        debugLog(`[会话 ${sessionId}][SSH终端模块] 已注册 SSH 相关消息处理器。`);
    };

    const unregisterAllSshHandlers = () => {
        debugLog(`[会话 ${sessionId}][SSH终端模块] 注销 SSH 相关消息处理器...`);
        unregisterHandlers.forEach(unregister => unregister?.());
        unregisterHandlers.length = 0; // 清空数组
    };

    // 初始化时自动注册处理程序
    registerSshHandlers();

    // --- 清理函数 ---
    const cleanup = () => {
        unregisterAllSshHandlers();
        cancelScheduledOutputDecode();
        outputDecodeMicrotaskScheduled = false;
        pendingBase64OutputQueue.length = 0;
        pendingBase64OutputHeadIndex = 0;
        if (outputFlushFrame !== null && terminalInstance.value) {
            getTerminalWindow(terminalInstance.value).cancelAnimationFrame(outputFlushFrame);
        }
        outputFlushFrame = null;
        outputFlushMicrotaskScheduled = false;
        isOutputWriteInProgress = false;
        if (outputFlushTimer !== null) {
            clearTimeout(outputFlushTimer);
            outputFlushTimer = null;
        }
        cancelOutputIdleFlush();
        pendingOutputBuffer.length = 0;
        pendingOutputHeadIndex = 0;
        pendingOutputBytes = 0;
        updateOutputFrameBudget(OUTPUT_FRAME_BUDGET_DEFAULT_BYTES);
        terminalRenderHighlighter.dispose();
        stopTerminalHighlightWatcher();
        resetTerminalLocalEcho(terminalLocalEchoState);
        if (inputFlushTimer !== null) {
            clearTimeout(inputFlushTimer);
            inputFlushTimer = null;
        }
        pendingInputBuffer.length = 0;
        // terminalInstance.value?.dispose(); // 终端实例的销毁由 TerminalComponent 负责
        terminalInstance.value = null;
        debugLog(`[会话 ${sessionId}][SSH终端模块] 已清理。`);
    };

    /**
     * 直接发送数据到 SSH 会话 (例如，从命令输入栏)
     * @param data 要发送的字符串数据
     */
    const sendData = (data: string) => {
        // console.debug(`[会话 ${sessionId}][SSH终端模块] 直接发送数据:`, data);
        scheduleTerminalInput(data);
    };

    // --- 搜索相关方法 (移除计数逻辑) ---

    // Removed countOccurrences helper function

    const searchNext = (term: string, options?: ISearchOptions): boolean => {
        const addon = searchAddon.value ?? ensureSearchAddonLoaded?.() ?? null;
        searchAddon.value = addon;
        if (addon) {
            debugLog(`[会话 ${sessionId}][SSH终端模块] 执行 searchNext: "${term}"`);
            const found = addon.findNext(term, options);
            // Removed manual count and state update
            return found;
        }
        console.warn(`[会话 ${sessionId}][SSH终端模块] searchNext 调用失败，searchAddon 不可用。`);
        // Removed state reset on failure
        return false;
    };

    const searchPrevious = (term: string, options?: ISearchOptions): boolean => {
        const addon = searchAddon.value ?? ensureSearchAddonLoaded?.() ?? null;
        searchAddon.value = addon;
        if (addon) {
             debugLog(`[会话 ${sessionId}][SSH终端模块] 执行 searchPrevious: "${term}"`);
            const found = addon.findPrevious(term, options);
            // Removed manual count and state update
            return found;
        }
         console.warn(`[会话 ${sessionId}][SSH终端模块] searchPrevious 调用失败，searchAddon 不可用。`);
         // Removed state reset on failure
        return false;
    };

    const clearTerminalSearch = () => {
        const addon = searchAddon.value;
        if (addon) {
            debugLog(`[会话 ${sessionId}][SSH终端模块] 清除搜索高亮。`);
            addon.clearDecorations();
        }
        // Removed state reset
        debugLog(`[会话 ${sessionId}][SSH终端模块] 搜索高亮已清除 (状态不再管理)。`);
    };


    // 返回工厂实例
    return {
        // 公共接口
        handleTerminalReady,
        handleTerminalData, // 这个处理来自 xterm.js 的输入
        handleTerminalResize,
        sendData, // 允许外部直接发送数据
        writeOutput: scheduleTerminalOutput,
        cleanup,
        // --- 搜索方法 ---
        searchNext,
        searchPrevious,
        clearTerminalSearch,
        // --- 暴露状态 ---
        isSshConnected: readonly(isSshConnected), // 暴露 SSH 连接状态 (只读)
        terminalInstance, // 暴露 terminal 实例，以便 WorkspaceView 可以写入提示信息
    };
}

// 保留兼容旧代码的函数（将在完全迁移后移除）
export function useSshTerminal(t: (key: string) => string) {
    console.warn('⚠️ 使用已弃用的 useSshTerminal() 全局单例。请迁移到 createSshTerminalManager() 工厂函数。');
    
    const terminalInstance = ref<Terminal | null>(null);
    
    const handleTerminalReady = (term: Terminal) => {
        debugLog('[SSH终端模块][旧] 终端实例已就绪，但使用了已弃用的单例模式。');
        terminalInstance.value = term;
    };
    
    const handleTerminalData = (data: string, options: { batched?: boolean; localEcho?: boolean } = {}) => {
        console.warn('[SSH终端模块][旧] 收到终端数据，但使用了已弃用的单例模式，无法发送。');
    };
    
    const handleTerminalResize = (dimensions: { cols: number; rows: number }) => {
        console.warn('[SSH终端模块][旧] 收到终端大小调整，但使用了已弃用的单例模式，无法发送。');
    };
    
    // 返回与旧接口兼容的空函数，以避免错误
    return {
        terminalInstance,
        handleTerminalReady,
        handleTerminalData,
        handleTerminalResize,
        registerSshHandlers: () => console.warn('[SSH终端模块][旧] 调用了已弃用的 registerSshHandlers'),
        unregisterAllSshHandlers: () => console.warn('[SSH终端模块][旧] 调用了已弃用的 unregisterAllSshHandlers'),
    };
}

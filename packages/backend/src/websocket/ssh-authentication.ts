import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { SshAuthChallenge, SshAuthResponse } from '@fantetic-terminal/contracts';
import type { SshAuthInteraction } from '../services/ssh-interactive-auth';

const pending = new WeakMap<WebSocket, { id: string; count: number; resolve: (answers: string[]) => void; cancel: () => void }>();

// Responses must bypass the control queue: ssh:connect is awaiting this response.
export const handleSshAuthResponse = (ws: WebSocket, payload: unknown): void => {
    const entry = pending.get(ws);
    if (!entry || !payload || typeof payload !== 'object') return;
    const response = payload as Partial<SshAuthResponse>;
    if (response.requestId !== entry.id) return;
    if (response.cancelled === true) { entry.cancel(); return; }
    if (!Array.isArray(response.answers) || response.answers.length !== entry.count
        || response.answers.some(answer => typeof answer !== 'string' || answer.length > 4096)) {
        entry.cancel();
        return;
    }
    pending.delete(ws);
    entry.resolve(response.answers);
};

export const createSshAuthInteraction = (ws: WebSocket, timeoutMs = 120_000): SshAuthInteraction & { dispose: () => void } => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectPending: ((error: Error) => void) | undefined;
    const cancel = () => {
        pending.delete(ws);
        if (timer) clearTimeout(timer);
        rejectPending?.(new Error('SSH authentication cancelled or expired'));
        rejectPending = undefined;
        controller.abort();
    };
    ws.once('close', cancel);
    return {
        signal: controller.signal,
        request: challenge => new Promise((resolve, reject) => {
            if (controller.signal.aborted || ws.readyState !== WebSocket.OPEN || pending.has(ws)) {
                reject(new Error('SSH authentication unavailable'));
                return;
            }
            if (challenge.prompts.length > 8 || challenge.prompts.some(item => item.prompt.length > 4096)
                || challenge.name.length > 4096 || challenge.instructions.length > 8192) {
                reject(new Error('SSH authentication challenge exceeds limits'));
                return;
            }
            rejectPending = reject;
            const requestId = randomUUID();
            pending.set(ws, { id: requestId, count: challenge.prompts.length, cancel, resolve: answers => {
                if (timer) clearTimeout(timer);
                rejectPending = undefined;
                resolve(answers);
            } });
            timer = setTimeout(cancel, timeoutMs);
            const payload: SshAuthChallenge = { ...challenge, requestId };
            try { ws.send(JSON.stringify({ type: 'ssh:auth-prompt', payload })); }
            catch { cancel(); }
        }),
        dispose: () => {
            ws.removeListener('close', cancel);
            cancel();
        },
    };
};

import type { Client, ConnectConfig, Prompt } from 'ssh2';
import type { SshAuthChallenge } from '@fantetic-terminal/contracts';

export interface SshAuthInteraction {
    signal: AbortSignal;
    request: (challenge: Omit<SshAuthChallenge, 'requestId'>) => Promise<string[]>;
}

export const configureInteractiveAuth = (client: Client, config: ConnectConfig, interaction: SshAuthInteraction): void => {
    let finished = false;
    let attempts = 0;
    let keyAttempted = false;
    let savedPasswordAttempted = false;
    let rounds = 0;
    const cleanup = () => {
        finished = true;
        interaction.signal.removeEventListener('abort', abort);
        client.removeListener('ready', cleanup);
        client.removeListener('error', cleanup);
        client.removeListener('close', cleanup);
    };
    const abort = () => {
        if (finished) return;
        // Never propagate server prompts or supplied answers into errors or logs.
        client.emit('error', new Error('SSH authentication cancelled or expired'));
        client.destroy();
        cleanup();
    };
    const prompt = (name: string, instructions: string, _lang: string, prompts: Prompt[], finish: (answers: string[]) => void) => {
        if (finished) return;
        if (++rounds > 12 || prompts.length > 8) { abort(); return; }
        if (prompts.length === 0) { finish([]); return; }
        void interaction.request({ name, instructions, username: config.username ?? '', prompts: prompts.map(item => ({ prompt: item.prompt, echo: item.echo === true })) })
            .then(answers => { if (!finished) finish(answers); }, abort);
    };
    config.authHandler = (methods, _partial, next) => {
        if (finished || interaction.signal.aborted) { abort(); return false; }
        if (!methods) return 'none';
        if (++attempts > 6) return false;
        if (config.privateKey && !keyAttempted && methods.includes('publickey')) {
            keyAttempted = true;
            return 'publickey';
        }
        if (typeof config.password === 'string' && !savedPasswordAttempted && methods.includes('password')) {
            savedPasswordAttempted = true;
            return 'password';
        }
        if (methods.includes('keyboard-interactive')) {
            return { type: 'keyboard-interactive', username: config.username ?? '', prompt };
        }
        if (methods.includes('password')) {
            prompt('', '', '', [{ prompt: 'Password:', echo: false }], answers => {
                next({ type: 'password', username: config.username ?? '', password: answers[0] ?? '' });
            });
            return;
        }
        return false;
    };
    interaction.signal.addEventListener('abort', abort, { once: true });
    client.once('ready', cleanup).once('error', cleanup).once('close', cleanup);
};

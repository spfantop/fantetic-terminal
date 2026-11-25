import type { SshAuthChallenge } from '@fantetic-terminal/contracts';

// Server text is displayed as plain text, never as terminal control sequences.
const plain = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');

export function createTerminalAuthInput(write: (text: string) => void, respond: (id: string, answers: string[] | null) => void) {
    let challenge: SshAuthChallenge | null = null;
    let answers: string[] = [];
    let line = '';
    const reset = () => { challenge = null; answers = []; line = ''; };
    const showPrompt = () => {
        if (challenge) write(plain(challenge.prompts[answers.length].prompt) + ' ');
    };
    const start = (next: SshAuthChallenge) => {
        reset();
        challenge = next;
        for (const text of [next.name, next.instructions]) {
            if (text) write(plain(text) + '\r\n');
        }
        if (next.username) write('(' + plain(next.username) + ') ');
        showPrompt();
    };
    const input = (data: string) => {
        if (!challenge || data.includes('\x1b')) return;
        for (const char of data.replace(/\r\n/g, '\r')) {
            const echo = challenge.prompts[answers.length].echo;
            if (char === '\x03') {
                const id = challenge.requestId;
                reset();
                write('^C\r\n');
                respond(id, null);
                return;
            }
            if (char === '\r' || char === '\n') {
                answers.push(line);
                line = '';
                write('\r\n');
                if (answers.length === challenge.prompts.length) {
                    const result = answers;
                    const id = challenge.requestId;
                    reset();
                    respond(id, result);
                    return;
                }
                showPrompt();
            } else if (char === '\x7f' || char === '\b' || char === '\x15') {
                const chars = Array.from(line);
                const count = char === '\x15' ? chars.length : Math.min(1, chars.length);
                line = chars.slice(0, chars.length - count).join('');
                if (echo) write('\b \b'.repeat(count));
            } else if (!/[\x00-\x1f\x7f-\x9f]/.test(char) && line.length + char.length <= 4096) {
                line += char;
                if (echo) write(char);
            }
        }
    };
    return { start, input, reset };
}

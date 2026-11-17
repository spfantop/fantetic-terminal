import type { Client, ConnectConfig, Prompt } from 'ssh2';

// PAM 可以在密码应答后再发送空提示；验证码和改密请求不能复用登录密码。
export const enableKeyboardPasswordAuth = (client: Client, config: ConnectConfig): void => {
    if (typeof config.password !== 'string' || config.privateKey) return;
    const password = config.password;
    let answered = false;
    const respond = (_name: string, _instructions: string, _lang: string, prompts: Prompt[], finish: (answers: string[]) => void) => {
        if (prompts.length === 0) {
            finish([]);
            return;
        }
        const prompt = prompts[0];
        if (!answered && prompts.length === 1 && !prompt.echo && /^\s*(?:password|密码)\s*[:：]\s*$/i.test(prompt.prompt)) {
            answered = true;
            finish([password]);
            return;
        }
        finish(prompts.map(() => ''));
    };
    const cleanup = () => {
        client.removeListener('keyboard-interactive', respond);
        client.removeListener('ready', cleanup);
        client.removeListener('close', cleanup);
        client.removeListener('error', cleanup);
    };
    config.tryKeyboard = true;
    client.on('keyboard-interactive', respond);
    client.once('ready', cleanup);
    client.once('close', cleanup);
    client.once('error', cleanup);
};

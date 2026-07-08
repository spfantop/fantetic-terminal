// packages/frontend/src/stores/session/actions/commandInputActions.ts

import { sessions } from '../state';

const isTerminalShellSessionKind = (kind?: string) => kind === 'ssh' || kind === 'telnet';

/**
 * 更新指定会话的命令输入框内容
 */
export const updateSessionCommandInput = (sessionId: string, content: string) => {
    const session = sessions.value.get(sessionId);
    if (isTerminalShellSessionKind(session?.kind)) {
        session.commandInputContent.value = content;
    } else if (session) {
        console.warn(`[CommandInputActions] 会话 ${sessionId} 不是 SSH/Telnet，跳过命令输入内容更新`);
    } else {
        console.warn(`[CommandInputActions] 尝试更新不存在的会话 ${sessionId} 的命令输入内容`);
    }
};

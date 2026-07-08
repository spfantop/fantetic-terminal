const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f]/;
const PASSWORD_PROMPT_PATTERN = /\b(password|passphrase|pin|otp)\b|密码|口令|验证码/i;
const MAX_PENDING_ECHO_LENGTH = 4096;
const MAX_RECENT_OUTPUT_LENGTH = 512;

export interface TerminalLocalEchoState {
  pendingEcho: string;
  recentOutput: string;
}

export const createTerminalLocalEchoState = (): TerminalLocalEchoState => ({
  pendingEcho: '',
  recentOutput: '',
});

export function resolveLocalEchoText(input: string, state: TerminalLocalEchoState): string {
  if (!input || CONTROL_CHARACTER_PATTERN.test(input) || PASSWORD_PROMPT_PATTERN.test(state.recentOutput)) {
    return '';
  }

  return input;
}

export function recordLocalEcho(input: string, state: TerminalLocalEchoState): void {
  if (!input) return;

  state.pendingEcho = `${state.pendingEcho}${input}`;
  if (state.pendingEcho.length > MAX_PENDING_ECHO_LENGTH) {
    state.pendingEcho = state.pendingEcho.slice(-MAX_PENDING_ECHO_LENGTH);
  }
}

export function rememberTerminalOutputText(output: string, state: TerminalLocalEchoState): void {
  if (!output) return;

  state.recentOutput = `${state.recentOutput}${output}`.slice(-MAX_RECENT_OUTPUT_LENGTH);
}

export function consumeLocalEchoFromOutput(output: string, state: TerminalLocalEchoState): string {
  if (!output || !state.pendingEcho) {
    rememberTerminalOutputText(output, state);
    return output;
  }

  let outputOffset = 0;
  let echoOffset = 0;
  while (
    outputOffset < output.length
    && echoOffset < state.pendingEcho.length
    && output[outputOffset] === state.pendingEcho[echoOffset]
  ) {
    outputOffset += 1;
    echoOffset += 1;
  }

  if (echoOffset === 0) {
    state.pendingEcho = '';
    rememberTerminalOutputText(output, state);
    return output;
  }

  state.pendingEcho = state.pendingEcho.slice(echoOffset);
  const remainingOutput = output.slice(outputOffset);
  rememberTerminalOutputText(remainingOutput, state);
  return remainingOutput;
}

export function resetTerminalLocalEcho(state: TerminalLocalEchoState): void {
  state.pendingEcho = '';
  state.recentOutput = '';
}

export function hasPendingLocalEcho(state: TerminalLocalEchoState): boolean {
  return state.pendingEcho.length > 0;
}

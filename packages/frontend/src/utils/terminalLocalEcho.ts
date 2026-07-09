const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f]/;
const PASSWORD_PROMPT_PATTERN = /\b(password|passphrase|pin|otp)\b|密码|口令|验证码/i;
const ALTERNATE_SCREEN_ENTER_PATTERN = /\x1b\[\?(?:47|1047|1049)h/;
const ALTERNATE_SCREEN_EXIT_PATTERN = /\x1b\[\?(?:47|1047|1049)l/;
const SHELL_PROMPT_PATTERN = /(?:^|\r|\n)[^\r\n]*[#$>] $/;
const FULLSCREEN_TEXT_PATTERN = /(?:^|\r|\n)\s*(?:top\s+-|htop\b|Tasks:|KiB Mem|MiB Mem|GNU nano|vim\b|--More--|less\b)/i;
const MAX_PENDING_ECHO_LENGTH = 4096;
const MAX_RECENT_OUTPUT_LENGTH = 512;

export interface TerminalLocalEchoState {
  pendingEcho: string;
  recentOutput: string;
  suppressed: boolean;
}

export const createTerminalLocalEchoState = (): TerminalLocalEchoState => ({
  pendingEcho: '',
  recentOutput: '',
  suppressed: false,
});

export function resolveLocalEchoText(input: string, state: TerminalLocalEchoState): string {
  if (!input || state.suppressed || CONTROL_CHARACTER_PATTERN.test(input) || PASSWORD_PROMPT_PATTERN.test(state.recentOutput)) {
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
  updateLocalEchoSuppression(output, state);
}

export function consumeLocalEchoFromOutput(output: string, state: TerminalLocalEchoState): string {
  if (!output || !state.pendingEcho) {
    rememberTerminalOutputText(output, state);
    return output;
  }

  let outputOffset = 0;
  let echoOffset = 0;
  while (outputOffset < output.length && echoOffset < state.pendingEcho.length) {
    const controlEnd = readTerminalControlSequenceEnd(output, outputOffset);
    if (controlEnd > outputOffset) {
      outputOffset = controlEnd;
      continue;
    }

    if (output[outputOffset] !== state.pendingEcho[echoOffset]) {
      break;
    }

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
  state.suppressed = false;
}

export function hasPendingLocalEcho(state: TerminalLocalEchoState): boolean {
  return state.pendingEcho.length > 0;
}

function updateLocalEchoSuppression(output: string, state: TerminalLocalEchoState): void {
  if (ALTERNATE_SCREEN_ENTER_PATTERN.test(output) || FULLSCREEN_TEXT_PATTERN.test(output)) {
    state.suppressed = true;
  }

  if (ALTERNATE_SCREEN_EXIT_PATTERN.test(output) || SHELL_PROMPT_PATTERN.test(state.recentOutput)) {
    state.suppressed = false;
  }
}

function readTerminalControlSequenceEnd(input: string, offset: number): number {
  if (input[offset] !== '\x1b') return offset;

  const next = input[offset + 1];
  if (!next) return offset;

  if (next === '[') {
    for (let index = offset + 2; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) return index + 1;
    }
    return offset;
  }

  if (next === ']' || next === 'P' || next === '_' || next === '^' || next === 'X') {
    for (let index = offset + 2; index < input.length; index += 1) {
      if (input[index] === '\x07') return index + 1;
      if (input[index] === '\x1b' && input[index + 1] === '\\') return index + 2;
    }
    return offset;
  }

  return offset + 2;
}

import type { SessionRecordingEvent } from '@fantetic-terminal/contracts';
import {
  consumeLocalEchoFromOutput,
  createTerminalLocalEchoState,
  recordLocalEcho,
  resetTerminalLocalEcho,
  resolveLocalEchoText,
} from './terminalLocalEcho';

export interface TerminalRecordingReplaySink {
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

const SHELL_PROMPT_PATTERN = /(?:^|\r|\n)[^\r\n]{0,512}[#$>%] $/;

const decodeBase64 = (data: string, decoder: TextDecoder): string => {
  const binary = atob(data);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return decoder.decode(bytes, { stream: true });
};

/**
 * Replays recorded input locally and removes the matching server echo. This
 * keeps commands visible for non-echoing sessions without duplicating normal
 * shell input or exposing input entered at password prompts.
 */
export function createTerminalRecordingEventRenderer(sink: TerminalRecordingReplaySink) {
  const localEchoState = createTerminalLocalEchoState();
  let inputDecoder = new TextDecoder();
  let outputDecoder = new TextDecoder();
  let commandInputEnabled = false;

  const renderInput = (data: string) => {
    const input = decodeBase64(data, inputDecoder);
    let visibleInput = '';

    for (const character of input) {
      if (character === '\r' || character === '\n') {
        commandInputEnabled = false;
        resolveLocalEchoText(character, localEchoState);
        continue;
      }
      if (!commandInputEnabled) continue;

      const visibleCharacter = resolveLocalEchoText(character, localEchoState);
      if (!visibleCharacter) continue;
      recordLocalEcho(visibleCharacter, localEchoState);
      visibleInput += visibleCharacter;
    }

    if (visibleInput) sink.write(visibleInput);
  };

  return {
    render(event: SessionRecordingEvent): void {
      if (event.type === 'input') {
        renderInput(event.data);
        return;
      }
      if (event.type === 'output') {
        const output = decodeBase64(event.data, outputDecoder);
        const visibleOutput = consumeLocalEchoFromOutput(output, localEchoState);
        if (visibleOutput) sink.write(visibleOutput);
        if (localEchoState.suppressed) commandInputEnabled = false;
        else if (SHELL_PROMPT_PATTERN.test(localEchoState.recentOutput)) commandInputEnabled = true;
        return;
      }
      if (event.type === 'resize') {
        sink.resize(Math.max(2, event.cols), Math.max(1, event.rows));
      }
    },
    reset(): void {
      resetTerminalLocalEcho(localEchoState);
      inputDecoder = new TextDecoder();
      outputDecoder = new TextDecoder();
      commandInputEnabled = false;
    },
  };
}

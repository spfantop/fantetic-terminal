import {
  TELNET_DO,
  TELNET_DONT,
  TELNET_IAC,
  TELNET_OPTION_ECHO,
  TELNET_OPTION_NAWS,
  TELNET_OPTION_SUPPRESS_GO_AHEAD,
  TELNET_SB,
  TELNET_SE,
  TELNET_WILL,
  TELNET_WONT,
  type ITelnetNegotiator,
  type TelnetParseResult,
} from './telnet.types';

export class TelnetNegotiator implements ITelnetNegotiator {
  private serverOptions = new Set<number>();

  private readonly supportedOptions = new Set<number>([
    TELNET_OPTION_ECHO,
    TELNET_OPTION_SUPPRESS_GO_AHEAD,
    TELNET_OPTION_NAWS,
  ]);

  parse(buffer: Buffer): TelnetParseResult {
    const responses: Buffer[] = [];
    const cleanBytes: number[] = [];
    let index = 0;

    while (index < buffer.length) {
      const byte = buffer[index];
      if (byte !== TELNET_IAC) {
        cleanBytes.push(byte);
        index += 1;
        continue;
      }

      const result = this.handleIACSequence(buffer, index);
      index = result.nextIndex;
      if (result.response) responses.push(result.response);
      if (result.cleanByte !== undefined) cleanBytes.push(result.cleanByte);
    }

    return { cleanData: Buffer.from(cleanBytes), responses };
  }

  private handleIACSequence(buffer: Buffer, startIndex: number): {
    nextIndex: number;
    response: Buffer | null;
    cleanByte?: number;
  } {
    const command = buffer[startIndex + 1];
    const option = buffer[startIndex + 2];

    if (command === TELNET_IAC) {
      return { nextIndex: startIndex + 2, response: null, cleanByte: 0xff };
    }
    if (command === undefined) {
      return { nextIndex: startIndex + 2, response: null };
    }
    if (command === TELNET_WILL) {
      this.serverOptions.add(option);
      return {
        nextIndex: startIndex + 3,
        response: Buffer.from([TELNET_IAC, this.supportedOptions.has(option) ? TELNET_DO : TELNET_DONT, option]),
      };
    }
    if (command === TELNET_WONT) {
      this.serverOptions.delete(option);
      return { nextIndex: startIndex + 3, response: null };
    }
    if (command === TELNET_DO) {
      return {
        nextIndex: startIndex + 3,
        response: Buffer.from([TELNET_IAC, this.supportedOptions.has(option) ? TELNET_WILL : TELNET_WONT, option]),
      };
    }
    if (command === TELNET_DONT) {
      return { nextIndex: startIndex + 3, response: null };
    }
    if (command === TELNET_SB) {
      return this.handleSubOption(buffer, startIndex);
    }

    return { nextIndex: startIndex + 2, response: null };
  }

  private handleSubOption(buffer: Buffer, startIndex: number): { nextIndex: number; response: Buffer | null } {
    let endIndex = startIndex + 2;
    while (endIndex < buffer.length - 1) {
      if (buffer[endIndex] === TELNET_IAC && buffer[endIndex + 1] === TELNET_SE) break;
      endIndex += 1;
    }
    return { nextIndex: Math.min(endIndex + 2, buffer.length), response: null };
  }

  negotiateNAWS(cols: number, rows: number): Buffer {
    return Buffer.from([
      TELNET_IAC,
      TELNET_SB,
      TELNET_OPTION_NAWS,
      (cols >> 8) & 0xff,
      cols & 0xff,
      (rows >> 8) & 0xff,
      rows & 0xff,
      TELNET_IAC,
      TELNET_SE,
    ]);
  }

  getSupportedOptions(): number[] {
    return Array.from(this.supportedOptions);
  }

  getServerOptions(): number[] {
    return Array.from(this.serverOptions);
  }
}

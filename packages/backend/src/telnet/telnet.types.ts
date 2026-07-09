export const TELNET_IAC = 255;
export const TELNET_WILL = 251;
export const TELNET_WONT = 252;
export const TELNET_DO = 253;
export const TELNET_DONT = 254;
export const TELNET_SB = 250;
export const TELNET_SE = 240;

export const TELNET_OPTION_ECHO = 1;
export const TELNET_OPTION_SUPPRESS_GO_AHEAD = 3;
export const TELNET_OPTION_NAWS = 31;

export interface TelnetParseResult {
  cleanData: Buffer;
  responses: Buffer[];
}

export type TelnetSocketState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface ITelnetNegotiator {
  parse(buffer: Buffer): TelnetParseResult;
  negotiateNAWS(cols: number, rows: number): Buffer;
  getSupportedOptions(): number[];
}

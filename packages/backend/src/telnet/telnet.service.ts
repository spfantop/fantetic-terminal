import * as net from 'net';
import { TelnetNegotiator } from './telnet-negotiation';
import type { TelnetSocketState } from './telnet.types';

export interface TelnetServiceOptions {
  host: string;
  port: number;
  timeout?: number;
}

export interface TelnetConnectResult {
  success: boolean;
  socket?: net.Socket;
  error?: string;
}

export class TelnetService {
  private socket: net.Socket | null = null;
  private readonly negotiator = new TelnetNegotiator();
  private state: TelnetSocketState = 'disconnected';

  constructor(private readonly options: TelnetServiceOptions) {}

  connect(): Promise<TelnetConnectResult> {
    return new Promise((resolve) => {
      const { host, port, timeout = 10000 } = this.options;
      this.state = 'connecting';

      let settled = false;
      const settle = (result: TelnetConnectResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      this.socket = net.createConnection({ host, port }, () => {
        this.state = 'connected';
        this.socket?.setTimeout(0);
        settle({ success: true, socket: this.socket ?? undefined });
      });

      this.socket.setTimeout(timeout);
      this.socket.on('timeout', () => {
        this.state = 'error';
        this.socket?.destroy();
        settle({ success: false, error: '连接超时' });
      });
      this.socket.on('error', (error) => {
        this.state = 'error';
        settle({ success: false, error: error.message });
      });
      this.socket.on('close', () => {
        this.state = 'disconnected';
      });
      this.socket.on('end', () => {
        this.state = 'disconnected';
      });
    });
  }

  write(data: string | Buffer): boolean {
    if (!this.socket || this.state !== 'connected') return false;
    this.socket.write(data);
    return true;
  }

  resize(cols: number, rows: number): boolean {
    if (!this.socket || this.state !== 'connected') return false;
    this.socket.write(this.negotiator.negotiateNAWS(cols, rows));
    return true;
  }

  onData(callback: (data: Buffer) => void): void {
    this.socket?.on('data', (rawBuffer: Buffer) => {
      const parsed = this.negotiator.parse(rawBuffer);
      for (const response of parsed.responses) {
        this.socket?.write(response);
      }
      if (parsed.cleanData.byteLength > 0) {
        callback(parsed.cleanData);
      }
    });
  }

  onClose(callback: () => void): void {
    this.socket?.on('close', callback);
  }

  onError(callback: (error: Error) => void): void {
    this.socket?.on('error', callback);
  }

  disconnect(): void {
    this.state = 'disconnected';
    this.socket?.destroy();
    this.socket = null;
  }

  getState(): TelnetSocketState {
    return this.state;
  }
}

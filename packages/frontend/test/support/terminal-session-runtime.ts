export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instanceList: FakeWebSocket[] = [];

  readonly sentFrameList: unknown[] = [];
  closeCallCount = 0;
  readyState = FakeWebSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instanceList.push(this);
  }

  send(frame: unknown) {
    this.sentFrameList.push(frame);
  }

  close(code = 1000, reason = '') {
    this.closeCallCount += 1;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  abnormalClose(code = 1006, reason = 'connection lost') {
    this.close(code, reason);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

Reflect.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    location: { protocol: 'http:', host: 'localhost' },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  },
});
Reflect.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: window.localStorage,
});
Reflect.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeWebSocket });

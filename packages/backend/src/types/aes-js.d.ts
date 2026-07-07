declare module 'aes-js' {
  export class Counter {
    _counter: Uint8Array;
    constructor(initialValue: number | Uint8Array | Buffer);
    increment(): void;
  }

  export namespace ModeOfOperation {
    class ctr {
      constructor(key: Uint8Array, counter: Counter);
      encrypt(data: Uint8Array): Uint8Array;
      decrypt(data: Uint8Array): Uint8Array;
    }
  }
}

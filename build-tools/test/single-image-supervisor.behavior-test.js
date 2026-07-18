const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  createShutdownController,
  resolveStartupTimeoutMs,
} = require('../../packages/single-image/supervisor');

class ImmediateExitChild extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.signalCode = null;
    this.killSignals = [];
  }

  kill(signal) {
    this.killSignals.push(signal);
    if (signal === 'SIGTERM') {
      this.exitCode = 0;
      this.emit('exit', 0, null);
    }
    return true;
  }
}

class HangingChild extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.signalCode = null;
    this.killSignals = [];
  }

  kill(signal) {
    this.killSignals.push(signal);
    return true;
  }
}

const run = async () => {
  assert.equal(resolveStartupTimeoutMs(undefined), 180_000);
  assert.equal(resolveStartupTimeoutMs('240000'), 240_000);
  assert.equal(resolveStartupTimeoutMs('invalid'), 180_000);
  assert.equal(resolveStartupTimeoutMs('-1'), 180_000);

  const child = new ImmediateExitChild();
  const exitCodes = [];
  const controller = createShutdownController({
    listChildren: () => [child],
    exit: code => exitCodes.push(code),
    emitLog: () => {},
    forceTimeoutMs: 50,
  });

  assert.equal(controller.shutdown('SIGTERM', 0), true);
  assert.equal(controller.shutdown('duplicate', 1), false);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(child.killSignals, ['SIGTERM']);
  assert.deepEqual(exitCodes, [0]);

  const hangingChild = new HangingChild();
  const forcedExitCodes = [];
  let forceShutdown;
  const forcedController = createShutdownController({
    listChildren: () => [hangingChild],
    exit: code => forcedExitCodes.push(code),
    emitLog: () => {},
    setTimer: callback => {
      forceShutdown = callback;
      return 1;
    },
    clearTimer: () => {},
  });

  forcedController.shutdown('SIGTERM', 0);
  assert.deepEqual(hangingChild.killSignals, ['SIGTERM']);
  forceShutdown();
  assert.deepEqual(hangingChild.killSignals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(forcedExitCodes, [0]);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

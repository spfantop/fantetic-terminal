import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { installProcessLifecycle } from '../config/process-lifecycle';

class FakeProcess extends EventEmitter {
  exitCode: number | undefined;
}

const fakeProcess = new FakeProcess();
const reasons: string[] = [];
const errors: unknown[] = [];
const lifecycle = installProcessLifecycle({
  process: fakeProcess,
  shutdown: async (reason) => { reasons.push(reason); },
  logError: (error) => { errors.push(error); },
});

fakeProcess.emit('SIGTERM');
fakeProcess.emit('SIGINT');
await lifecycle.completion;
assert.deepEqual(reasons, ['SIGTERM'], 'shutdown must be idempotent across repeated signals');
assert.equal(fakeProcess.exitCode, 0);
lifecycle.dispose();

const fatalProcess = new FakeProcess();
const fatalReasons: string[] = [];
const fatal = installProcessLifecycle({
  process: fatalProcess,
  shutdown: async (reason) => { fatalReasons.push(reason); },
  logError: (error) => { errors.push(error); },
});
fatalProcess.emit('uncaughtException', new Error('boom'));
await fatal.completion;
assert.deepEqual(fatalReasons, ['uncaughtException']);
assert.equal(fatalProcess.exitCode, 1);
assert.match(String(errors.at(-1)), /boom/);

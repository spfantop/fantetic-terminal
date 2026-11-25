const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { applyNodePtyPatch } = require('../apply-patches');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fantetic-pty-patch-'));
try {
  const installed = path.dirname(require.resolve('node-pty/package.json'));
  const target = path.join(root, 'node_modules/node-pty');
  fs.mkdirSync(path.join(target, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(installed, 'package.json'), path.join(target, 'package.json'));
  const filename = path.join(target, 'lib/windowsPtyAgent.js');
  fs.copyFileSync(path.join(installed, 'lib/windowsPtyAgent.js'), filename);
  applyNodePtyPatch(root);
  const patched = fs.readFileSync(filename, 'utf8');
  applyNodePtyPatch(root);
  assert.equal(fs.readFileSync(filename, 'utf8'), patched);
  const exports = {};
  vm.runInNewContext(patched, {
    exports, require: createRequire(path.join(installed, 'lib/windowsPtyAgent.js')),
    process: { kill: () => assert.fail('missing list must not kill arbitrary PID') },
  });
  const agent = Object.create(exports.WindowsPtyAgent.prototype);
  let killed = 0;
  let disposed = 0;
  Object.assign(agent, {
    _useConpty: true, _useConptyDll: false, _inSocket: {}, _outSocket: {},
    _getConsoleProcessList: () => ({ then: callback => callback(undefined) }),
    _ptyNative: { kill: () => killed++ },
    _conoutSocketWorker: { dispose: () => disposed++ },
  });
  const originalExports = {};
  vm.runInNewContext(patched.replace(
    '(Array.isArray(consoleProcessList) ? consoleProcessList : []).forEach(function (pid) {',
    'consoleProcessList.forEach(function (pid) {',
  ), {
    exports: originalExports, require: createRequire(path.join(installed, 'lib/windowsPtyAgent.js')),
    process: { kill: () => assert.fail('unexpected PID') },
  });
  assert.throws(() => originalExports.WindowsPtyAgent.prototype.kill.call(agent), /forEach/);
  assert.equal(killed, 0, 'upstream failure prevents releasing the PTY');
  assert.doesNotThrow(() => agent.kill());
  assert.equal(killed, 1);
  assert.equal(disposed, 1);
  fs.writeFileSync(filename, 'incompatible upstream');
  assert.throws(() => applyNodePtyPatch(root), /incompatible/);
  console.log('node-pty missing console process list cleanup and patch idempotence: PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

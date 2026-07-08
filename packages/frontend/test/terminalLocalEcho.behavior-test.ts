import { strict as assert } from 'node:assert';
import {
  consumeLocalEchoFromOutput,
  createTerminalLocalEchoState,
  hasPendingLocalEcho,
  recordLocalEcho,
  rememberTerminalOutputText,
  resolveLocalEchoText,
} from '../src/utils/terminalLocalEcho';

const state = createTerminalLocalEchoState();

assert.equal(resolveLocalEchoText('abc', state), 'abc');
recordLocalEcho('abc', state);
assert.equal(hasPendingLocalEcho(state), true);
assert.equal(consumeLocalEchoFromOutput('abc', state), '');
assert.equal(hasPendingLocalEcho(state), false);
assert.equal(consumeLocalEchoFromOutput('\r\n', state), '\r\n');

assert.equal(resolveLocalEchoText('\r', state), '');
assert.equal(resolveLocalEchoText('\x03', state), '');
assert.equal(resolveLocalEchoText('\x1b[A', state), '');

recordLocalEcho('hel', state);
assert.equal(consumeLocalEchoFromOutput('he', state), '');
assert.equal(consumeLocalEchoFromOutput('llo', state), 'lo');

const passwordState = createTerminalLocalEchoState();
rememberTerminalOutputText('Password: ', passwordState);
assert.equal(resolveLocalEchoText('secret', passwordState), '');

const chinesePasswordState = createTerminalLocalEchoState();
rememberTerminalOutputText('请输入密码：', chinesePasswordState);
assert.equal(resolveLocalEchoText('secret', chinesePasswordState), '');

const mismatchState = createTerminalLocalEchoState();
recordLocalEcho('abc', mismatchState);
assert.equal(consumeLocalEchoFromOutput('XYZ', mismatchState), 'XYZ');
assert.equal(hasPendingLocalEcho(mismatchState), false);

console.log('terminal local echo behavior ok');

import { strict as assert } from 'node:assert';
import {
  consumeLocalEchoFromOutput,
  createTerminalLocalEchoState,
  hasPendingLocalEcho,
  recordLocalEcho,
  rememberTerminalOutputText,
  resetTerminalLocalEcho,
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

rememberTerminalOutputText('\x1b[?2004hhyf@debian:~$ ', state);
assert.equal(resolveLocalEchoText('x', state), 'x');
rememberTerminalOutputText('\x1b[?1049h\x1b[?25l', state);
assert.equal(resolveLocalEchoText('i', state), '');
rememberTerminalOutputText('\x1b[?1049l\x1b[?25hhyf@debian:~$ ', state);
assert.equal(resolveLocalEchoText('x', state), 'x');

resetTerminalLocalEcho(state);
rememberTerminalOutputText('top - 12:00:00 up 1 day\r\n', state);
assert.equal(resolveLocalEchoText('q', state), '');
rememberTerminalOutputText('hyf@debian:~$ ', state);
assert.equal(resolveLocalEchoText('q', state), 'q');

const escapedEchoState = createTerminalLocalEchoState();
recordLocalEcho('abc', escapedEchoState);
assert.equal(consumeLocalEchoFromOutput('a\x1b[?2004hbc', escapedEchoState), '');
assert.equal(hasPendingLocalEcho(escapedEchoState), false);

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

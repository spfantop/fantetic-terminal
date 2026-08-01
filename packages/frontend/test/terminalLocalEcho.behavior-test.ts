import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  consumeLocalEchoFromOutput,
  createTerminalLocalEchoState,
  hasPendingLocalEcho,
  recordLocalEcho,
  rememberTerminalOutputBytes,
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
assert.equal(resolveLocalEchoText('x', state), '', 'history navigation must hand the current line to remote Readline');
assert.equal(state.pendingEcho, '', 'editing controls must clear pending local echo');
rememberTerminalOutputText('\r\nyunwei@host:~$ ', state);
assert.equal(resolveLocalEchoText('x', state), 'x', 'a new shell prompt may re-enable local echo');

const cursorEditingState = createTerminalLocalEchoState();
recordLocalEcho('previous command', cursorEditingState);
assert.equal(resolveLocalEchoText('\x1b[D', cursorEditingState), '');
assert.equal(resolveLocalEchoText('X', cursorEditingState), '', 'typing after cursor movement must not overwrite the xterm row locally');

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
assert.equal(
  consumeLocalEchoFromOutput('a\x1b[?2004hbc', escapedEchoState),
  '\x1b[?2004h',
  'echo de-duplication must preserve remote terminal mode sequences',
);
assert.equal(hasPendingLocalEcho(escapedEchoState), false);

recordLocalEcho('hel', state);
assert.equal(consumeLocalEchoFromOutput('he', state), '');
assert.equal(consumeLocalEchoFromOutput('llo', state), 'lo');

const passwordState = createTerminalLocalEchoState();
rememberTerminalOutputText('Password: ', passwordState);
assert.equal(resolveLocalEchoText('secret', passwordState), '');
assert.equal(resolveLocalEchoText('\r', passwordState), '');
rememberTerminalOutputText('\r\nroot@host:~$ ', passwordState);
assert.equal(resolveLocalEchoText('next-command', passwordState), 'next-command');

const batchedPasswordState = createTerminalLocalEchoState();
rememberTerminalOutputText('Password: ', batchedPasswordState);
assert.equal(resolveLocalEchoText('secret\r', batchedPasswordState), '');
assert.equal(resolveLocalEchoText('next-command', batchedPasswordState), 'next-command');

const binaryPasswordState = createTerminalLocalEchoState();
rememberTerminalOutputBytes(new TextEncoder().encode('Password: '), binaryPasswordState);
assert.equal(resolveLocalEchoText('secret', binaryPasswordState), '');

const sshTerminalSource = readFileSync(resolve('src/composables/useSshTerminal.ts'), 'utf8');
assert.match(
  sshTerminalSource,
  /scheduleTerminalByteOutput[\s\S]*rememberTerminalOutputBytes/,
  'binary SSH output must update password-prompt state before rendering',
);

const chinesePasswordState = createTerminalLocalEchoState();
rememberTerminalOutputText('请输入密码：', chinesePasswordState);
assert.equal(resolveLocalEchoText('secret', chinesePasswordState), '');

const mismatchState = createTerminalLocalEchoState();
recordLocalEcho('abc', mismatchState);
assert.equal(consumeLocalEchoFromOutput('XYZ', mismatchState), 'XYZ');
assert.equal(hasPendingLocalEcho(mismatchState), false);

console.log('terminal local echo behavior ok');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sshTerminalManager = readFileSync(resolve('src/composables/useSshTerminal.ts'), 'utf8');
const sshSuspendActions = readFileSync(resolve('src/stores/session/actions/sshSuspendActions.ts'), 'utf8');

assert.match(
  sshTerminalManager,
  /writeOutput:\s*scheduleTerminalOutput/,
  'terminal manager should expose the same highlighted output path for restored cached chunks',
);

assert.match(
  sshSuspendActions,
  /session\.terminalManager\.writeOutput\(payload\.data\)/,
  'restored SSH cached chunks should be written through terminalManager.writeOutput so output highlighting still applies',
);

assert.match(
  sshTerminalManager,
  /currentSessionState\.pendingOutput\.forEach\(data => \{\s*scheduleTerminalOutput\(data\);/s,
  'buffered restored SSH cached chunks should also enter the highlighted output path when the terminal becomes ready',
);

assert.doesNotMatch(
  sshSuspendActions,
  /SSH Suspend Frontend[\s\S]{0,220}terminalInstance\.value\.write\(payload\.data\)/,
  'restored SSH cached chunks must not write directly to xterm because that bypasses highlighting',
);

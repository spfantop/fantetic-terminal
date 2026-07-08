import assert from 'node:assert/strict';
import { resolveTerminalBatchInputTargetIds } from '../src/utils/terminalBatchInput';

const sessions = new Map([
  ['ssh-1', { kind: 'ssh' }],
  ['ssh-2', { kind: 'ssh' }],
  ['telnet-1', { kind: 'telnet' }],
  ['rdp-1', { kind: 'rdp' }],
  ['ssh-popout', { kind: 'ssh' }],
]);

assert.deepEqual(
  resolveTerminalBatchInputTargetIds({
    sourceSessionId: 'ssh-1',
    batchEnabled: true,
    workspaceSplitActive: true,
    workspaceSplitSessionIds: ['ssh-1', 'rdp-1', 'telnet-1', 'ssh-2'],
    sessions,
  }),
  ['ssh-1', 'telnet-1', 'ssh-2'],
);

assert.deepEqual(
  resolveTerminalBatchInputTargetIds({
    sourceSessionId: 'ssh-popout',
    batchEnabled: true,
    workspaceSplitActive: true,
    workspaceSplitSessionIds: ['ssh-1', 'ssh-2'],
    sessions,
  }),
  ['ssh-popout'],
);

assert.deepEqual(
  resolveTerminalBatchInputTargetIds({
    sourceSessionId: 'ssh-1',
    batchEnabled: false,
    workspaceSplitActive: true,
    workspaceSplitSessionIds: ['ssh-1', 'ssh-2'],
    sessions,
  }),
  ['ssh-1'],
);

console.log('terminalBatchInput behavior ok');

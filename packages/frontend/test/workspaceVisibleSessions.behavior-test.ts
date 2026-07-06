import assert from 'node:assert/strict';
import {
  resolveVisibleActiveSessionId,
  resolveWorkspaceLayoutActiveSessionId,
} from '../src/utils/workspaceVisibleSessions';

const visibleSessionIds = ['ssh-main-1', 'ssh-main-2'];

assert.equal(
  resolveVisibleActiveSessionId({
    activeSessionId: 'ssh-popout',
    visibleSessionIds,
  }),
  null,
  'tab bar should not mark a hidden popped-out session as active',
);

assert.equal(
  resolveWorkspaceLayoutActiveSessionId({
    activeSessionId: 'ssh-popout',
    visibleSessionIds,
    previousLayoutActiveSessionId: 'ssh-main-2',
    fullscreenSessionId: null,
  }),
  'ssh-main-2',
  'popped-out terminal focus must keep the original workspace terminal visible',
);

assert.equal(
  resolveWorkspaceLayoutActiveSessionId({
    activeSessionId: 'ssh-popout',
    visibleSessionIds,
    previousLayoutActiveSessionId: 'ssh-closed',
    fullscreenSessionId: null,
  }),
  'ssh-main-1',
  'workspace should fall back to a visible session when the previous visible active session is gone',
);

assert.equal(
  resolveWorkspaceLayoutActiveSessionId({
    activeSessionId: 'ssh-popout',
    visibleSessionIds,
    previousLayoutActiveSessionId: 'ssh-main-2',
    fullscreenSessionId: 'ssh-popout',
  }),
  'ssh-popout',
  'fullscreen session should keep driving the layout even when it is popped out',
);

console.log('workspace visible sessions behavior ok');

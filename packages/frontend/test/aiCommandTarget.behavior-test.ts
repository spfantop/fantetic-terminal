import assert from 'node:assert/strict';
import {
  resolveAICommandInputTarget,
  shouldShowAICommandEntry,
} from '../src/utils/aiCommandTarget';

assert.equal(
  resolveAICommandInputTarget({
    targetSessionId: 'ssh-popout',
    activeSessionId: 'ssh-main',
  }),
  'ssh-popout',
  'AI generated command should prefer the explicit terminal target',
);

assert.equal(
  resolveAICommandInputTarget({
    targetSessionId: null,
    activeSessionId: 'ssh-main',
  }),
  'ssh-main',
  'AI generated command should fall back to the active terminal when no explicit target exists',
);

assert.equal(
  resolveAICommandInputTarget({
    targetSessionId: undefined,
    activeSessionId: null,
  }),
  null,
  'AI generated command should not write to any terminal when no target can be resolved',
);

assert.equal(
  shouldShowAICommandEntry({ isMobile: false, isAIEnabled: false }),
  false,
  'desktop command bar should hide the AI command entry when AI is not enabled',
);

assert.equal(
  shouldShowAICommandEntry({ isMobile: false, isAIEnabled: true }),
  true,
  'desktop command bar should show the AI command entry when AI is enabled',
);

assert.equal(
  shouldShowAICommandEntry({ isMobile: true, isAIEnabled: true }),
  false,
  'mobile command bar should keep the compact existing controls',
);

console.log('AI command target behavior ok');

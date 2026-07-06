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
  true,
  'desktop command bar should keep the AI command entry discoverable even before AI is enabled',
);

assert.equal(
  shouldShowAICommandEntry({ isMobile: true, isAIEnabled: true }),
  false,
  'mobile command bar should keep the compact existing controls',
);

console.log('AI command target behavior ok');

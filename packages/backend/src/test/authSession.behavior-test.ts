import assert from 'node:assert/strict';

import { completeLogin, startTwoFactorChallenge } from '../auth/auth-session';

const events: string[] = [];
const request = {
  session: {
    id: 'attacker-controlled-session',
    cookie: {},
    regenerate(callback: (error?: Error) => void) {
      events.push('regenerate');
      request.session = {
        cookie: {},
        save(saveCallback: (error?: Error) => void) {
          events.push('save');
          saveCallback();
        },
      } as typeof request.session;
      callback();
    },
  },
} as any;

await completeLogin(request, { id: 7, username: 'alice' }, { rememberMe: false });

assert.deepEqual(events, ['regenerate', 'save']);
assert.equal(request.session.userId, 7);
assert.equal(request.session.username, 'alice');
assert.equal(request.session.requiresTwoFactor, false);
assert.equal(request.session.cookie.maxAge, undefined);

const pendingRequest = {
  session: {
    cookie: {},
    regenerate(callback: (error?: Error) => void) {
      pendingRequest.session = {
        cookie: {},
        save(saveCallback: (error?: Error) => void) { saveCallback(); },
      } as typeof pendingRequest.session;
      callback();
    },
  },
} as any;
await startTwoFactorChallenge(pendingRequest, { userId: 9, rememberMe: true });
assert.equal(pendingRequest.session.userId, undefined, '2FA challenge must not authenticate the session');
assert.equal(pendingRequest.session.pendingTwoFactorUserId, 9);
assert.equal(pendingRequest.session.requiresTwoFactor, true);

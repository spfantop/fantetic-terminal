import assert from 'node:assert/strict';

import {
  UserAdministrationApplication,
  UserAdministrationRepository,
} from '../access-control/user-administration.application';
import { AuthorizationSubject } from '../access-control/authorization-subject';

const users = new Map<number, any>();
const repository: UserAdministrationRepository = {
  async listUsers() { return [...users.values()]; },
  async readUser(userId) { return users.get(userId) ?? null; },
  async createUser(input) {
    const user = { id: users.size + 2, username: input.username, systemRole: input.systemRole, status: 'active' as const };
    users.set(user.id, user);
    return user;
  },
  async updateUser(input) {
    const current = users.get(input.userId);
    const user = { ...current, systemRole: input.systemRole, status: input.status };
    users.set(input.userId, user);
    return user;
  },
  async countActiveSuperAdmins() {
    return [...users.values()].filter((user) => user.systemRole === 'super_admin' && user.status === 'active').length;
  },
};
const application = new UserAdministrationApplication(repository, async (password) => `hashed:${password}`);
const superAdmin: AuthorizationSubject = {
  runtime: 'web', userId: 1, username: 'root', systemRole: 'super_admin',
};
const admin: AuthorizationSubject = {
  runtime: 'web', userId: 9, username: 'admin', systemRole: 'admin',
};

const alice = await application.createUser(superAdmin, {
  username: 'alice', password: 'Strong-password-1', systemRole: 'user',
});
assert.equal(alice.username, 'alice');

await assert.rejects(
  application.createUser(admin, {
    username: 'shadow-admin', password: 'Strong-password-1', systemRole: 'admin',
  }),
  /super administrator/i,
);

await assert.rejects(
  application.updateUser(superAdmin, superAdmin.userId, { status: 'disabled' }),
  /yourself/i,
);

users.set(1, { id: 1, username: 'root', systemRole: 'super_admin', status: 'active' });
users.set(5, { id: 5, username: 'backup-root', systemRole: 'super_admin', status: 'active' });
assert.equal((await application.updateUser(superAdmin, 5, { status: 'disabled' })).status, 'disabled');

await assert.rejects(
  application.updateUser(admin, alice.id, { systemRole: 'admin' }),
  /super administrator/i,
);

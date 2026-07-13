import { SystemRole } from './access-policy';
import { AuthorizationSubject } from './authorization-subject';

export type ManagedUser = {
  id: number;
  username: string;
  systemRole: SystemRole;
  status: 'active' | 'disabled';
};

export interface UserAdministrationRepository {
  listUsers(): Promise<ManagedUser[]>;
  readUser(userId: number): Promise<ManagedUser | null>;
  createUser(input: {
    username: string;
    hashedPassword: string;
    systemRole: SystemRole;
  }): Promise<ManagedUser>;
  updateUser(input: {
    userId: number;
    systemRole?: SystemRole;
    status?: 'active' | 'disabled';
  }): Promise<ManagedUser>;
  updatePassword(userId: number, hashedPassword: string): Promise<void>;
  deleteUser(userId: number, transferToUserId: number): Promise<void>;
  countActiveSuperAdmins(): Promise<number>;
}

type PasswordHasher = (password: string) => Promise<string>;

const isSystemAdministrator = (subject: AuthorizationSubject) => (
  subject.systemRole === 'super_admin' || subject.systemRole === 'admin'
);

export class UserAdministrationApplication {
  constructor(
    private readonly repository: UserAdministrationRepository,
    private readonly hashPassword: PasswordHasher,
  ) {}

  async listUsers(subject: AuthorizationSubject): Promise<ManagedUser[]> {
    if (!isSystemAdministrator(subject)) throw new Error('A system administrator is required.');
    return this.repository.listUsers();
  }

  async createUser(
    subject: AuthorizationSubject,
    input: { username: string; password: string; systemRole: SystemRole },
  ): Promise<ManagedUser> {
    if (!isSystemAdministrator(subject)) throw new Error('A system administrator is required.');
    if ((input.systemRole === 'super_admin' || input.systemRole === 'admin')
      && subject.systemRole !== 'super_admin') {
      throw new Error('A super administrator is required to create an administrator.');
    }
    const username = input.username.trim();
    if (!username) throw new Error('A username is required.');
    if (input.password.length < 12) throw new Error('The password must contain at least 12 characters.');
    return this.repository.createUser({
      username,
      hashedPassword: await this.hashPassword(input.password),
      systemRole: input.systemRole,
    });
  }

  async updateUser(
    subject: AuthorizationSubject,
    userId: number,
    input: { systemRole?: SystemRole; status?: 'active' | 'disabled' },
  ): Promise<ManagedUser> {
    if (!isSystemAdministrator(subject)) throw new Error('A system administrator is required.');
    if (subject.userId === userId && input.status === 'disabled') {
      throw new Error('You cannot disable yourself.');
    }
    const target = await this.repository.readUser(userId);
    if (!target) throw new Error('User not found.');
    const targetPrivileged = target.systemRole === 'super_admin' || target.systemRole === 'admin';
    const elevatingToAdministrator = input.systemRole === 'super_admin' || input.systemRole === 'admin';
    if (subject.systemRole !== 'super_admin' && (targetPrivileged || elevatingToAdministrator)) {
      throw new Error('A super administrator is required to manage administrators.');
    }
    const removingActiveSuperAdmin = target.systemRole === 'super_admin'
      && target.status === 'active'
      && (input.status === 'disabled' || (input.systemRole && input.systemRole !== 'super_admin'));
    if (removingActiveSuperAdmin && await this.repository.countActiveSuperAdmins() <= 1) {
      throw new Error('The last active super administrator cannot be removed.');
    }
    return this.repository.updateUser({ userId, ...input });
  }

  async resetPassword(
    subject: AuthorizationSubject,
    userId: number,
    password: string,
  ): Promise<void> {
    if (!isSystemAdministrator(subject)) throw new Error('A system administrator is required.');
    if (password.length < 12) throw new Error('The password must contain at least 12 characters.');
    const target = await this.repository.readUser(userId);
    if (!target) throw new Error('User not found.');
    const targetPrivileged = target.systemRole === 'super_admin' || target.systemRole === 'admin';
    if (subject.systemRole !== 'super_admin' && targetPrivileged) {
      throw new Error('A super administrator is required to manage administrators.');
    }
    await this.repository.updatePassword(userId, await this.hashPassword(password));
  }

  async deleteUser(
    subject: AuthorizationSubject,
    userId: number,
    transferToUserId: number,
  ): Promise<void> {
    if (subject.systemRole !== 'super_admin') throw new Error('A super administrator is required.');
    if (subject.userId === userId) throw new Error('You cannot delete yourself.');
    if (userId === transferToUserId) throw new Error('A different transfer user is required.');
    const [target, receiver] = await Promise.all([
      this.repository.readUser(userId),
      this.repository.readUser(transferToUserId),
    ]);
    if (!target || !receiver) throw new Error('User not found.');
    if (receiver.status !== 'active') throw new Error('The transfer user must be active.');
    if (target.systemRole === 'super_admin' && target.status === 'active'
      && await this.repository.countActiveSuperAdmins() <= 1) {
      throw new Error('The last active super administrator cannot be removed.');
    }
    await this.repository.deleteUser(userId, transferToUserId);
  }
}

import { Database } from 'sqlite3';

import { getDb, runDb, withTransaction } from '../database/connection';

export interface InitialAdministratorInput {
  username: string;
  hashedPassword: string;
  now: number;
}

export interface InitialAdministratorResult {
  created: boolean;
  userId?: number;
}

/**
 * Creates the only first Web-runtime administrator. The database transaction
 * owns the empty-system invariant, so concurrent setup requests cannot each
 * promote a different account.
 */
export const createInitialAdministrator = async (
  db: Database,
  input: InitialAdministratorInput,
): Promise<InitialAdministratorResult> => withTransaction(db, async transactionDb => {
  const existingUser = await getDb<{ id: number }>(transactionDb, 'SELECT id FROM users LIMIT 1');
  if (existingUser) {
    return { created: false };
  }

  const result = await runDb(
    transactionDb,
    `INSERT INTO users (username, hashed_password, system_role, status, created_at, updated_at)
     VALUES (?, ?, 'super_admin', 'active', ?, ?)`,
    [input.username, input.hashedPassword, input.now, input.now],
  );

  return { created: true, userId: result.lastID };
}, { mode: 'immediate' });

import { Database } from 'sqlite3';
import { getDb, runDb } from '../database/connection';
import { ELECTRON_APP_USER_ID, ELECTRON_APP_USERNAME } from './app-mode';

type RuntimeUserRow = {
  id: number;
  username: string;
};

export const ensureElectronRuntimeUser = async (database: Database): Promise<void> => {
  const userWithReservedId = await getDb<RuntimeUserRow>(
    database,
    'SELECT id, username FROM users WHERE id = ?',
    [ELECTRON_APP_USER_ID],
  );
  if (userWithReservedId) {
    if (userWithReservedId.username !== ELECTRON_APP_USERNAME) {
      throw new Error(`Electron runtime user ID ${ELECTRON_APP_USER_ID} is already reserved by another user`);
    }
    return;
  }

  const userWithReservedName = await getDb<RuntimeUserRow>(
    database,
    'SELECT id, username FROM users WHERE username = ?',
    [ELECTRON_APP_USERNAME],
  );
  if (userWithReservedName) {
    throw new Error(`Electron runtime username ${ELECTRON_APP_USERNAME} is already assigned to user ID ${userWithReservedName.id}`);
  }

  await runDb(
    database,
    `INSERT INTO users (id, username, hashed_password, system_role, status, auth_epoch)
     VALUES (?, ?, ?, 'super_admin', 'active', 0)`,
    [ELECTRON_APP_USER_ID, ELECTRON_APP_USERNAME, '!electron-runtime-user!'],
  );
};

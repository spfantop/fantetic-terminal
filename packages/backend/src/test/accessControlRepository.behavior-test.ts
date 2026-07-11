import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';

import { createAccessControlTablesSQL } from '../access-control/access-control.schema';
import { SqliteAccessControlRepository } from '../access-control/access-control.repository';

const db = new sqlite3.Database(':memory:');
await new Promise<void>((resolve, reject) => db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE);
  CREATE TABLE connections (id INTEGER PRIMARY KEY, owner_user_id INTEGER);
  ${createAccessControlTablesSQL}
  INSERT INTO users(id, username) VALUES (1, 'root'), (2, 'alice');
  INSERT INTO connections(id, owner_user_id) VALUES (10, 1);
`, (error) => error ? reject(error) : resolve()));

const repository = new SqliteAccessControlRepository(async () => db);
const group = await repository.createGroup({
  name: 'ops',
  description: 'Operators',
  createdBy: 1,
});
assert.equal(group.name, 'ops');
assert.deepEqual(await repository.readMembership(group.id, 1), {
  groupId: group.id,
  userId: 1,
  role: 'owner',
});

await repository.saveMembership({ groupId: group.id, userId: 2, role: 'operator' });
await repository.saveConnectionGrant({ connectionId: 10, groupId: group.id, permission: 'connect' });
assert.deepEqual(await repository.readConnectionAccess(2, 10), {
  ownerUserId: 1,
  grants: [{ groupRole: 'operator', permission: 'connect' }],
});
assert.deepEqual(await repository.listGroupsForUser(2, false), [{
  id: group.id,
  name: 'ops',
  description: 'Operators',
  createdBy: 1,
  memberRole: 'operator',
}]);
assert.deepEqual(await repository.listMembers(group.id), [
  { groupId: group.id, userId: 2, username: 'alice', role: 'operator' },
  { groupId: group.id, userId: 1, username: 'root', role: 'owner' },
]);
assert.deepEqual(await repository.listConnectionGrants(10), [{
  connectionId: 10,
  groupId: group.id,
  groupName: 'ops',
  permission: 'connect',
}]);

await new Promise<void>((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

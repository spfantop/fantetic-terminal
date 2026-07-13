import { Router } from 'express';

import { isAuthenticated } from '../auth/auth.middleware';
import {
  createGroup,
  deleteConnectionGrant,
  deleteGroup,
  deleteMember,
  listConnectionGrants,
  listGroups,
  listMembers,
  saveConnectionGrant,
  saveConnectionGrants,
  saveMember,
  readAdministrationSummary,
  updateGroup,
} from './access-control.controller';
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  updateUser,
} from './user-administration.controller';
import { requireSystemAdministrator } from './system-administrator.middleware';

const router = Router();
router.use(isAuthenticated);
router.get('/summary', requireSystemAdministrator, readAdministrationSummary);

router.get('/users', listUsers);
router.post('/users', createUser);
router.patch('/users/:userId', updateUser);
router.put('/users/:userId/password', resetUserPassword);
router.delete('/users/:userId', deleteUser);

router.get('/groups', listGroups);
router.post('/groups', createGroup);
router.patch('/groups/:groupId', updateGroup);
router.delete('/groups/:groupId', deleteGroup);
router.get('/groups/:groupId/members', listMembers);
router.put('/groups/:groupId/members/:userId', saveMember);
router.delete('/groups/:groupId/members/:userId', deleteMember);
router.get('/connections/:connectionId/groups', listConnectionGrants);
router.put('/connections/groups/batch', saveConnectionGrants);
router.put('/connections/:connectionId/groups/:groupId', saveConnectionGrant);
router.delete('/connections/:connectionId/groups/:groupId', deleteConnectionGrant);

export default router;

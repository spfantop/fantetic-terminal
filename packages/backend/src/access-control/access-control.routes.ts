import { Router } from 'express';

import { isAuthenticated } from '../auth/auth.middleware';
import {
  createGroup,
  listConnectionGrants,
  listGroups,
  listMembers,
  saveConnectionGrant,
  saveMember,
} from './access-control.controller';
import {
  createUser,
  listUsers,
  updateUser,
} from './user-administration.controller';

const router = Router();
router.use(isAuthenticated);

router.get('/users', listUsers);
router.post('/users', createUser);
router.patch('/users/:userId', updateUser);

router.get('/groups', listGroups);
router.post('/groups', createGroup);
router.get('/groups/:groupId/members', listMembers);
router.put('/groups/:groupId/members/:userId', saveMember);
router.get('/connections/:connectionId/groups', listConnectionGrants);
router.put('/connections/:connectionId/groups/:groupId', saveConnectionGrant);

export default router;

import express, { RequestHandler } from 'express';
import { isAuthenticated } from '../auth/auth.middleware';
import {
    getAllProxies,
    getProxyById,
    createProxy,
    updateProxy,
    deleteProxy
} from './proxies.controller';
import { requireResourceOwner } from '../access-control/resource-ownership.middleware';

const router = express.Router();


router.use(isAuthenticated);


router.get('/', getAllProxies as RequestHandler);
router.get('/:id', requireResourceOwner('proxies'), getProxyById as RequestHandler);
router.post('/', createProxy as RequestHandler);
router.put('/:id', requireResourceOwner('proxies'), updateProxy as RequestHandler);
router.delete('/:id', requireResourceOwner('proxies'), deleteProxy as RequestHandler);

export default router;

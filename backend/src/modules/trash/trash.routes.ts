import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import * as controller from './trash.controller';

const router = Router();

router.use(authMiddleware);
router.get('/', requireRoles('admin'), controller.findAll);
router.post('/bulk-delete', requireRoles('admin'), controller.bulkDelete);

export default router;

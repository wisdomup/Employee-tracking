import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import * as controller from './trash.controller';

const router = Router();

router.use(authMiddleware);
router.get('/', requirePermission('trash:view'), controller.findAll);
router.post('/bulk-delete', requirePermission('trash:delete'), controller.bulkDelete);

export default router;

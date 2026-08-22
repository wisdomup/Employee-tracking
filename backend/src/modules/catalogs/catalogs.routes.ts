import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { uploadPdfSingle } from '../../middleware/upload.middleware';
import * as controller from './catalogs.controller';

const router = Router();

router.use(authMiddleware);

router.post(
  '/',
  requirePermission('catalogs:add'),
  (req: Request, res: Response, next: NextFunction) => {
    uploadPdfSingle(req, res, (err: unknown) => {
      if (err) {
        return res.status(400).json({
          message: err instanceof Error ? err.message : 'PDF upload failed',
        });
      }
      next();
    });
  },
  controller.create,
);

router.get('/', requirePermission('catalogs:view'), controller.findAll);
router.get('/:id', requirePermission('catalogs:view'), controller.findOne);

router.put(
  '/:id',
  requirePermission('catalogs:edit'),
  (req: Request, res: Response, next: NextFunction) => {
    uploadPdfSingle(req, res, (err: unknown) => {
      if (err) {
        return res.status(400).json({
          message: err instanceof Error ? err.message : 'PDF upload failed',
        });
      }
      next();
    });
  },
  controller.update,
);

router.delete('/:id', requirePermission('catalogs:delete'), controller.remove);

export default router;

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { uploadPdfSingle } from '../../middleware/upload.middleware';
import * as controller from './catalogs.controller';

const router = Router();

router.use(authMiddleware);

router.post(
  '/',
  requireRoles('admin'),
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

router.get('/', controller.findAll);
router.get('/:id', controller.findOne);

router.put(
  '/:id',
  requireRoles('admin'),
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

router.delete('/:id', requireRoles('admin'), controller.remove);

export default router;

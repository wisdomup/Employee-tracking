import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { uploadSingle } from '../../middleware/upload.middleware';
import * as controller from './upload.controller';

const router = Router();

router.use(authMiddleware);

router.post(
  '/',
  (req: Request, res: Response, next: NextFunction) => {
    uploadSingle(req, res, (err: unknown) => {
      if (err) {
        return res.status(400).json({
          message: err instanceof Error ? err.message : 'File upload failed',
        });
      }
      next();
    });
  },
  controller.uploadImage,
);

export default router;

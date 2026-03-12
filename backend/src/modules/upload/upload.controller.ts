import { Request, Response, NextFunction } from 'express';
import { saveFile } from '../../services/file-upload.service';

const ALLOWED_CATEGORIES = ['profiles', 'shops', 'products', 'categories', 'general', 'completions'] as const;

export async function uploadImage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ message: 'No file uploaded. Use field name "file".' });
      return;
    }

    const category = (req.query.category as string) || 'general';
    if (!ALLOWED_CATEGORIES.includes(category as (typeof ALLOWED_CATEGORIES)[number])) {
      res.status(400).json({
        message: `Invalid category. Use one of: ${ALLOWED_CATEGORIES.join(', ')}`,
      });
      return;
    }

    const url = await saveFile(req.file, category);
    res.status(200).json({ url });
  } catch (err) {
    next(err);
  }
}

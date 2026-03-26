import { Request, Response, NextFunction } from 'express';
import * as trashService from './trash.service';

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { module, startDate, endDate, search } = req.query as Record<string, string>;
    const items = await trashService.getTrashItems({ module, startDate, endDate, search });
    res.json(items);
  } catch (err) {
    next(err);
  }
}

export async function bulkDelete(req: Request, res: Response, next: NextFunction) {
  try {
    const { items } = req.body as { items: { module: any; entityId: string }[] };
    const result = await trashService.bulkPermanentDelete(items ?? []);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

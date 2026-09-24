import { Request, Response, NextFunction } from 'express';
import * as registers from './registers.service';

function window(req: Request): { from?: string; to?: string } {
  const q = req.query as Record<string, string | undefined>;
  return { from: q.from || undefined, to: q.to || undefined };
}

export async function reversals(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await registers.listReversals(window(req)));
  } catch (err) {
    next(err);
  }
}

export async function writeOffs(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await registers.listWriteOffs(window(req)));
  } catch (err) {
    next(err);
  }
}

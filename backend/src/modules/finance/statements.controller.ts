import { Request, Response, NextFunction } from 'express';
import * as statements from './financial-statements.service';

export async function profitAndLoss(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(
      await statements.profitAndLoss({
        from: q.from,
        to: q.to,
        compare: q.compare === 'true',
        showZero: q.showZero === 'true',
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function balanceSheet(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(await statements.balanceSheet({ asOf: q.asOf, showZero: q.showZero === 'true' }));
  } catch (err) {
    next(err);
  }
}

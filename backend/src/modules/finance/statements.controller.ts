import { Request, Response, NextFunction } from 'express';
import * as statements from './financial-statements.service';
import * as parties from './party-reports.service';
import * as cash from './cash-reports.service';

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

export async function receivablesAgeing(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await parties.receivablesAgeing({ asOf: (req.query.asOf as string) || undefined }));
  } catch (err) {
    next(err);
  }
}

export async function payablesAgeing(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await parties.payablesAgeing());
  } catch (err) {
    next(err);
  }
}

export async function partyList(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await parties.partiesWithActivity(req.query.type as parties.PartyType));
  } catch (err) {
    next(err);
  }
}

export async function partyStatement(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(
      await parties.partyStatement({
        type: q.type as parties.PartyType,
        id: q.id,
        from: q.from || undefined,
        to: q.to || undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function cashFlow(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(await cash.cashFlow({ from: q.from || undefined, to: q.to || undefined }));
  } catch (err) {
    next(err);
  }
}

export async function cashPosition(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(await cash.cashPosition({ from: q.from || undefined, to: q.to || undefined }));
  } catch (err) {
    next(err);
  }
}

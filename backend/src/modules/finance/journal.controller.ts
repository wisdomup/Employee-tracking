import { Request, Response, NextFunction } from 'express';
import * as journal from './journal.service';
import * as posting from './posting.service';
import * as periods from './period.service';

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(
      await journal.listEntries({
        status: q.status,
        sourceType: q.sourceType,
        period: q.period,
        from: q.from,
        to: q.to,
        search: q.search,
        limit: q.limit ? Number(q.limit) : undefined,
        skip: q.skip ? Number(q.skip) : undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await journal.getEntry(req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function createDraft(req: Request, res: Response, next: NextFunction) {
  try {
    const entry = await journal.createDraft(req.body, req.user!.userId);
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
}

export async function updateDraft(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await journal.updateDraft(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function deleteDraft(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await journal.deleteDraft(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function post(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await posting.postDraft(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function reverse(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await posting.reverseEntry(
      req.params.id,
      { reason: req.body.reason, date: req.body.date ? new Date(req.body.date) : undefined },
      req.user!.userId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function trialBalance(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await journal.trialBalance(req.query.asOf as string | undefined));
  } catch (err) {
    next(err);
  }
}

export async function ledgerStatement(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(await journal.ledgerStatement(req.params.ledgerId, { from: q.from, to: q.to }));
  } catch (err) {
    next(err);
  }
}

export async function dayBook(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    const from = q.from ?? new Date().toISOString().slice(0, 10);
    res.json(await journal.dayBook(from, q.to));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export async function listPeriods(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await periods.listPeriods(req.query.fiscalYear as string | undefined));
  } catch (err) {
    next(err);
  }
}

export async function openPeriod(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await periods.openPeriod(req.body.period, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function openFiscalYear(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await periods.openFiscalYear(req.body.fiscalYear, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function periodChecks(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ period: req.params.period, checks: await periods.closeChecks(req.params.period) });
  } catch (err) {
    next(err);
  }
}

export async function closePeriod(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await periods.closePeriod(req.body.period, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function reopenPeriod(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await periods.reopenPeriod(req.body.period, req.body.reason, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function lockThrough(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await periods.lockThrough(req.body.period, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export async function recalculate(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await posting.recalculateLedger(req.params.ledgerId));
  } catch (err) {
    next(err);
  }
}

export async function reconcile(req: Request, res: Response, next: NextFunction) {
  try {
    // `repair` rewrites the cached balances from the lines, which are the truth. Without it the
    // check reports drift it cannot fix.
    res.json(await posting.reconcileLedgerBalances({ repair: req.query.repair === 'true' }));
  } catch (err) {
    next(err);
  }
}

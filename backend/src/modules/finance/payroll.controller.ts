import { Request, Response, NextFunction } from 'express';
import * as payroll from './payroll.service';

// ---------------------------------------------------------------------------
// Payroll runs
// ---------------------------------------------------------------------------

export async function listRuns(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await payroll.listRuns({
        status: req.query.status as 'draft' | 'posted' | 'cancelled' | 'all' | undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function getRun(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payroll.getRun(req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function createRun(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await payroll.createRun(req.body.period, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function updateRun(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payroll.updateRun(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function removeRun(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payroll.deleteRun(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function postRun(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payroll.postRun(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function payRun(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payroll.recordPayment(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function cancelRun(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payroll.cancelRun(req.params.id, req.body.reason, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Staff advances
// ---------------------------------------------------------------------------

export async function employees(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payroll.payrollEmployees());
  } catch (err) {
    next(err);
  }
}

export async function listAdvances(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(
      await payroll.listAdvances({
        status: q.status as 'draft' | 'posted' | 'cancelled' | 'all' | undefined,
        userId: q.userId,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function advanceBalances(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payroll.advanceBalances());
  } catch (err) {
    next(err);
  }
}

export async function createAdvance(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await payroll.createAdvance(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function updateAdvance(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payroll.updateAdvance(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function removeAdvance(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payroll.deleteAdvance(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function postAdvance(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payroll.postAdvance(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function cancelAdvance(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payroll.cancelAdvance(req.params.id, req.body.reason, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

import { Request, Response, NextFunction } from 'express';
import * as bankRec from './bank-reconciliation.service';

export async function accounts(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await bankRec.reconcilableAccounts());
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(
      await bankRec.listReconciliations({
        ledgerId: q.ledgerId,
        status: q.status as 'draft' | 'completed' | 'all' | undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await bankRec.getReconciliation(req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await bankRec.createReconciliation(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await bankRec.updateReconciliation(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function setCleared(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await bankRec.setClearedLines(
        req.params.id,
        req.body.lineIds,
        req.body.cleared,
        req.user!.userId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function complete(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await bankRec.completeReconciliation(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function reopen(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await bankRec.reopenReconciliation(req.params.id, req.body.reason, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await bankRec.deleteReconciliation(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

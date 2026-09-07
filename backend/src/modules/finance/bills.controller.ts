import { Request, Response, NextFunction } from 'express';
import * as bills from './bills.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(
      await bills.listBills({
        vendorId: q.vendorId,
        status: q.status as 'draft' | 'posted' | 'cancelled' | 'all' | undefined,
        from: q.from,
        to: q.to,
        overdue: q.overdue === 'true',
        search: q.search,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await bills.getBill(req.params.id));
  } catch (err) {
    next(err);
  }
}

/**
 * The goods receipts a bill for this supplier could still be matched against.
 *
 * `billId` is passed when an existing draft is being edited, so its own matched receipts stay
 * on the list instead of vanishing as already-billed the moment the form reopens.
 */
export async function openReceipts(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await bills.openReceiptsForVendor(req.params.vendorId, {
        includeBillId: (req.query.billId as string) || undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await bills.createBill(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await bills.updateBill(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await bills.deleteBill(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function post(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await bills.postBill(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await bills.cancelBill(req.params.id, req.body.reason, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

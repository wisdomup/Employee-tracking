import { Request, Response, NextFunction } from 'express';
import { PaymentMethod } from '../../models/supplier-payment.model';
import * as payments from './payments.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(
      await payments.listPayments({
        vendorId: q.vendorId,
        status: q.status as 'draft' | 'posted' | 'cancelled' | 'all' | undefined,
        method: q.method as PaymentMethod | undefined,
        from: q.from,
        to: q.to,
        search: q.search,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payments.getPayment(req.params.id));
  } catch (err) {
    next(err);
  }
}

/**
 * A supplier's bills that still have something unpaid.
 *
 * `paymentId` is passed when an existing draft is being edited, so the bills it already settles
 * stay on the list instead of reading as paid the moment the form reopens.
 */
export async function openBills(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await payments.openBillsForVendor(req.params.vendorId, {
        includePaymentId: (req.query.paymentId as string) || undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await payments.createPayment(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payments.updatePayment(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payments.deletePayment(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function post(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payments.postPayment(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await payments.cancelPayment(req.params.id, req.body.reason, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

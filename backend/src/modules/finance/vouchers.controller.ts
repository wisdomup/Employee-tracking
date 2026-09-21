import { Request, Response, NextFunction } from 'express';
import { VoucherCategory } from '../../models/voucher.model';
import { ROLES } from '../../constants/global';
import * as vouchers from './vouchers.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(
      await vouchers.listVouchers({
        category: q.category as VoucherCategory | undefined,
        status: q.status as never,
        from: q.from,
        to: q.to,
        partyId: q.partyId,
        search: q.search,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function shops(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vouchers.voucherShops(req.query.search as string | undefined));
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vouchers.getVoucher(req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await vouchers.createVoucher(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vouchers.updateVoucher(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vouchers.deleteVoucher(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function submit(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vouchers.submitVoucher(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function approve(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await vouchers.approveVoucher(req.params.id, req.user!.userId, {
        isAdmin: req.user!.roles.includes(ROLES.ADMIN),
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function reject(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vouchers.rejectVoucher(req.params.id, req.body.reason, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function post(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vouchers.postVoucher(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vouchers.cancelVoucher(req.params.id, req.body.reason, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

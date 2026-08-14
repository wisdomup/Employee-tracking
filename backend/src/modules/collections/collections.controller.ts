import { Request, Response, NextFunction } from 'express';
import * as collectionsService from './collections.service';
import * as recoveryService from './credit-recovery.service';
import * as settlementsService from './settlements.service';
import * as reportsService from './collection-reports.service';
import { normalizeCityKey } from '../region-sales/region-sales.rules';
import { forbidden } from '../../utils/app-error';

/**
 * Thin controllers: unwrap the request, call the service, return the bare resource. The one
 * piece of logic that lives here is scope narrowing — a rider may never widen a query to
 * another rider, so `riderId` is overwritten rather than validated. Same idiom as
 * `orders.controller.findAll`.
 */

function isRider(req: Request): boolean {
  return req.user?.role === 'delivery_man';
}

/** A rider's own id always wins over whatever the query string asked for. */
function scopedRiderId(req: Request): string | undefined {
  if (isRider(req)) return req.user!.userId;
  const raw = (req.query.riderId as string) || undefined;
  return raw && raw !== 'all' ? raw : undefined;
}

/** `cityKey` is only meaningful for admins; a rider is already confined to their own city. */
function scopedCityKey(req: Request): string | undefined {
  if (isRider(req)) return undefined;
  const raw = req.query.cityKey as string | undefined;
  if (raw === undefined || raw === '' || raw === 'all') return undefined;
  return normalizeCityKey(raw);
}

// --- Rider -----------------------------------------------------------------

export async function myOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const { date, status } = req.query as Record<string, string>;
    res.json(await collectionsService.getRiderOrders(req.user!.userId, { date, status }));
  } catch (err) {
    next(err);
  }
}

export async function myBalance(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reportsService.getRiderBalance(req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function markPacked(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await collectionsService.markPacked(req.params.orderId, req.user!.userId);
    res.json({ order, message: 'Order marked packed' });
  } catch (err) {
    next(err);
  }
}

export async function deliver(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await collectionsService.deliverOrder(
      req.params.orderId,
      req.user!.userId,
      req.body,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

// --- Credit recovery -------------------------------------------------------

export async function createRecovery(req: Request, res: Response, next: NextFunction) {
  try {
    // An admin may back-fill on a rider's behalf; a rider is always themselves.
    const riderId = isRider(req) ? req.user!.userId : (req.body.riderId as string) || req.user!.userId;
    res.status(201).json(await recoveryService.createRecovery(riderId, req.body));
  } catch (err) {
    next(err);
  }
}

export async function listRecoveries(req: Request, res: Response, next: NextFunction) {
  try {
    const { dealerId, from, to } = req.query as Record<string, string>;
    res.json(
      await recoveryService.listRecoveries({
        riderId: scopedRiderId(req),
        dealerId,
        cityKey: scopedCityKey(req),
        from,
        to,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function dealerOutstanding(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reportsService.getDealerOutstanding(req.params.dealerId));
  } catch (err) {
    next(err);
  }
}

// --- Settlement ------------------------------------------------------------

export async function submitSettlement(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await settlementsService.submitSettlement(req.user!.userId, req.body));
  } catch (err) {
    next(err);
  }
}

export async function listSettlements(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, mode, from, to } = req.query as Record<string, string>;
    res.json(
      await settlementsService.listSettlements({
        riderId: scopedRiderId(req),
        status: status as 'pending' | 'received' | undefined,
        mode: mode as 'cash' | 'online' | undefined,
        cityKey: scopedCityKey(req),
        from,
        to,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function receiveSettlement(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await settlementsService.receiveSettlement(req.params.id, req.user!.userId, req.body?.note),
    );
  } catch (err) {
    next(err);
  }
}

// --- Admin corrections -----------------------------------------------------

export async function correctCollection(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await collectionsService.correctCollection(req.params.id, req.user!.userId, req.body));
  } catch (err) {
    next(err);
  }
}

export async function voidCollection(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await collectionsService.voidCollection(req.params.id, req.user!.userId, req.body.reason),
    );
  } catch (err) {
    next(err);
  }
}

export async function correctRecovery(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await recoveryService.correctRecovery(req.params.id, req.user!.userId, req.body));
  } catch (err) {
    next(err);
  }
}

export async function voidRecovery(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await recoveryService.voidRecovery(req.params.id, req.user!.userId, req.body.reason));
  } catch (err) {
    next(err);
  }
}

export async function correctSettlement(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await settlementsService.correctSettlement(req.params.id, req.user!.userId, req.body));
  } catch (err) {
    next(err);
  }
}

export async function voidSettlement(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await settlementsService.voidSettlement(req.params.id, req.user!.userId, req.body.reason),
    );
  } catch (err) {
    next(err);
  }
}

// --- Reports ---------------------------------------------------------------

export async function report(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to, page, limit } = req.query as Record<string, string>;
    res.json(
      await reportsService.getCollectionReport({
        riderId: scopedRiderId(req),
        cityKey: scopedCityKey(req),
        from,
        to,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function activity(req: Request, res: Response, next: NextFunction) {
  try {
    const { date } = req.query as Record<string, string>;
    res.json(await reportsService.getTodayActivity({ riderId: scopedRiderId(req), date }));
  } catch (err) {
    next(err);
  }
}

export async function dayEnd(req: Request, res: Response, next: NextFunction) {
  try {
    const { date } = req.query as Record<string, string>;
    res.json(
      await reportsService.getDayEndSummary({
        riderId: scopedRiderId(req),
        cityKey: scopedCityKey(req),
        date,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function riders(req: Request, res: Response, next: NextFunction) {
  try {
    if (isRider(req)) return next(forbidden('Insufficient permissions'));
    res.json(await reportsService.listRiders());
  } catch (err) {
    next(err);
  }
}

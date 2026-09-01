import { Request, Response, NextFunction } from 'express';
import * as ordersService from './orders.service';
import { badRequest, forbidden } from '../../utils/app-error';
import { serializeOrderForRole, serializeOrdersForRole } from '../../utils/product-privacy';

function orderCreatedById(doc: { createdBy?: unknown }): string {
  const c = doc.createdBy;
  if (c == null) return '';
  if (typeof c === 'object' && c !== null && '_id' in c) {
    return String((c as { _id: unknown })._id);
  }
  return String(c);
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'admin') {
      delete req.body.termsAndConditions;
      // The source warehouse follows the salesman's city; only an admin may override it.
      delete req.body.warehouseId;
    }
    // An order taker's punch IS a field record: without their coordinates there is nothing to
    // compare against the client's pin, so the punch is refused rather than stored unverifiable.
    if (req.user?.role === 'order_taker') {
      const { latitude, longitude } = req.body as { latitude?: unknown; longitude?: unknown };
      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return next(
          badRequest(
            'Your current location is required to punch an order. Allow location access for this site and try again.',
          ),
        );
      }
    }
    const order = await ordersService.createOrder(req.body, req.user!.userId, req.user?.role);
    res.status(201).json(serializeOrderForRole(order, req.user?.role));
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { dealerId, routeId, status, createdBy, assignedRiderId, startDate, endDate } =
      req.query as Record<string, string>;
    let effectiveCreatedBy = createdBy;
    if (req.user?.role === 'order_taker') {
      effectiveCreatedBy = req.user.userId;
    }
    const orders = await ordersService.findAll({
      dealerId,
      routeId,
      status,
      createdBy: effectiveCreatedBy,
      assignedRiderId,
      startDate,
      endDate,
    });
    res.json(serializeOrdersForRole(orders as unknown[], req.user?.role));
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await ordersService.findById(req.params.id);
    if (req.user?.role === 'order_taker' && req.user.userId) {
      if (orderCreatedById(order as { createdBy?: unknown }) !== req.user.userId) {
        return next(forbidden('You can only view orders you created'));
      }
    }
    res.json(serializeOrderForRole(order, req.user?.role));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user?.role !== 'admin') {
      delete req.body.termsAndConditions;
      delete req.body.warehouseId;
    }
    if (req.user?.role === 'order_taker') {
      const existing = await ordersService.findById(req.params.id);
      if (orderCreatedById(existing as { createdBy?: unknown }) !== req.user!.userId) {
        return next(forbidden('You can only edit orders you created'));
      }
      if (existing.status !== 'pending') {
        return next(forbidden('Order takers can only edit orders that are still pending'));
      }
      delete req.body.status;
    }
    // Cancelling credits stock back, so it is an admin-only transition. `employee` otherwise
    // reaches it through this route and can cancel any order.
    if (req.body?.status === 'cancelled' && req.user?.role !== 'admin') {
      return next(forbidden('Only an admin can cancel an order'));
    }
    const order = await ordersService.updateOrder(req.params.id, req.body, req.user?.userId);
    res.json(serializeOrderForRole(order, req.user?.role));
  } catch (err) {
    next(err);
  }
}

export async function approve(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await ordersService.approveOrder(req.params.id, req.user?.userId, req.body);
    res.json(serializeOrderForRole(order, req.user?.role));
  } catch (err) {
    next(err);
  }
}

export async function assignRider(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = req.body?.assignedRiderId;
    const riderId = raw === '' || raw === null || raw === undefined ? null : String(raw);
    const order = await ordersService.assignRider(req.params.id, riderId, req.user?.userId);
    res.json(serializeOrderForRole(order, req.user?.role));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await ordersService.deleteOrder(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function restore(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await ordersService.restoreOrder(req.params.id, req.user?.userId);
    res.json(serializeOrderForRole(result, req.user?.role));
  } catch (err) {
    next(err);
  }
}

export async function removePermanent(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await ordersService.permanentlyDeleteOrder(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

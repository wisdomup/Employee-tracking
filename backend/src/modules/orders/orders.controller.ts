import { Request, Response, NextFunction } from 'express';
import * as ordersService from './orders.service';
import { forbidden } from '../../utils/app-error';
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
    }
    const order = await ordersService.createOrder(req.body, req.user!.userId);
    res.status(201).json(serializeOrderForRole(order, req.user?.role));
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { dealerId, routeId, status, createdBy, startDate, endDate } = req.query as Record<string, string>;
    let effectiveCreatedBy = createdBy;
    if (req.user?.role === 'order_taker') {
      effectiveCreatedBy = req.user.userId;
    }
    const orders = await ordersService.findAll({
      dealerId,
      routeId,
      status,
      createdBy: effectiveCreatedBy,
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

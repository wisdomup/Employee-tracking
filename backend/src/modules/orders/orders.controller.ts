import { Request, Response, NextFunction } from 'express';
import * as ordersService from './orders.service';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await ordersService.createOrder(req.body, req.user!.userId);
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { dealerId, routeId, status, createdBy, startDate, endDate } = req.query as Record<string, string>;
    const orders = await ordersService.findAll({ dealerId, routeId, status, createdBy, startDate, endDate });
    res.json(orders);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await ordersService.findById(req.params.id);
    res.json(order);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await ordersService.updateOrder(req.params.id, req.body, req.user?.userId);
    res.json(order);
  } catch (err) {
    next(err);
  }
}

export async function approve(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await ordersService.approveOrder(req.params.id, req.user?.userId);
    res.json(order);
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
    res.json(result);
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

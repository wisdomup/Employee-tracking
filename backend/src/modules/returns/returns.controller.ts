import { Request, Response, NextFunction } from 'express';
import * as returnsService from './returns.service';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const returnDoc = await returnsService.createReturn(req.body, req.user!.userId);
    res.status(201).json(returnDoc);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { dealerId, productId, returnType, createdBy } = req.query as Record<string, string>;
    const returns = await returnsService.findAll({ dealerId, productId, returnType, createdBy });
    res.json(returns);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const returnDoc = await returnsService.findById(req.params.id);
    res.json(returnDoc);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const returnDoc = await returnsService.updateReturn(req.params.id, req.body);
    res.json(returnDoc);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await returnsService.deleteReturn(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

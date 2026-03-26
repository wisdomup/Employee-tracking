import { Request, Response, NextFunction } from 'express';
import * as productsService from './products.service';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await productsService.createProduct(req.body, req.user!.userId);
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { categoryId, search } = req.query as Record<string, string>;
    const products = await productsService.findAll({ categoryId, search });
    res.json(products);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await productsService.findById(req.params.id);
    res.json(product);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await productsService.updateProduct(req.params.id, req.body, req.user?.userId);
    res.json(product);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await productsService.deleteProduct(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function restore(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await productsService.restoreProduct(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function removePermanent(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await productsService.permanentlyDeleteProduct(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

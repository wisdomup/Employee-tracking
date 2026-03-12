import { Request, Response, NextFunction } from 'express';
import * as categoriesService from './categories.service';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await categoriesService.createCategory(req.body, req.user!.userId);
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { search } = req.query as Record<string, string>;
    const categories = await categoriesService.findAll({ search });
    res.json(categories);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await categoriesService.findById(req.params.id);
    res.json(category);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await categoriesService.updateCategory(req.params.id, req.body);
    res.json(category);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await categoriesService.deleteCategory(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

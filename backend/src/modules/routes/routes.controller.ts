import { Request, Response, NextFunction } from 'express';
import * as routesService from './routes.service';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const route = await routesService.createRoute(req.body, req.user?.userId);
    res.status(201).json(route);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { search } = req.query as Record<string, string>;
    const routes = await routesService.findAll(search);
    res.json(routes);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const route = await routesService.findById(req.params.id);
    res.json(route);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const route = await routesService.updateRoute(req.params.id, req.body, req.user?.userId);
    res.json(route);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await routesService.deleteRoute(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function restore(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await routesService.restoreRoute(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function removePermanent(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await routesService.permanentlyDeleteRoute(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

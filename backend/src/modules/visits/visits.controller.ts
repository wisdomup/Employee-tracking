import { Request, Response, NextFunction } from 'express';
import * as visitsService from './visits.service';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const visit = await visitsService.createVisit(req.body, req.user?.userId);
    res.status(201).json(visit);
  } catch (err) {
    next(err);
  }
}

export async function createForRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const { routeId } = req.body as { routeId: string };
    const result = await visitsService.createVisitsForRoute(routeId, req.user?.userId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { dealerId, employeeId, routeId, status, startDate, endDate } = req.query as Record<string, string>;
    const visits = await visitsService.findAll({ dealerId, employeeId, routeId, status, startDate, endDate });
    res.json(visits);
  } catch (err) {
    next(err);
  }
}

export async function completeVisit(req: Request, res: Response, next: NextFunction) {
  try {
    const visit = await visitsService.completeVisit(
      req.params.id,
      req.body as { latitude: number; longitude: number; completionImages: { type: 'shop' | 'selfie'; url: string }[] },
      req.user!.userId,
      req.user!.role,
    );
    res.json(visit);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const visit = await visitsService.findById(req.params.id);
    res.json(visit);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const visit = await visitsService.updateVisit(req.params.id, req.body);
    res.json(visit);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await visitsService.deleteVisit(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

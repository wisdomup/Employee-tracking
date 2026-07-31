import { Request, Response, NextFunction } from 'express';
import * as analyticsService from './analytics.service';

export async function performance(req: Request, res: Response, next: NextFunction) {
  try {
    const { periodMonth, employeeId } = req.query as Record<string, string>;
    const report = await analyticsService.getPerformance(
      { periodMonth, employeeId },
      req.user!.userId,
      req.user!.role,
    );
    res.json(report);
  } catch (err) {
    next(err);
  }
}

export async function trend(req: Request, res: Response, next: NextFunction) {
  try {
    const { employeeId, months } = req.query as Record<string, string>;
    const data = await analyticsService.getTrend(
      { employeeId, months: months ? Number(months) : undefined },
      req.user!.userId,
      req.user!.role,
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}

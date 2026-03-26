import { Request, Response, NextFunction } from 'express';
import * as dashboardService from './dashboard.service';

export async function getStats(_req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await dashboardService.getDashboardStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

export async function getReports(req: Request, res: Response, next: NextFunction) {
  try {
    const { startDate, endDate, groupBy, viewBy } = req.query as Record<string, string>;
    const reports = await dashboardService.getDashboardReports({
      startDate,
      endDate,
      groupBy: groupBy as 'day' | 'month' | 'year' | undefined,
      viewBy: viewBy as 'item' | 'category' | undefined,
    });
    res.json(reports);
  } catch (err) {
    next(err);
  }
}

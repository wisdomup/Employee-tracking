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

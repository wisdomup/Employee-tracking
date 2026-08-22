import { Request, Response, NextFunction } from 'express';
import * as dashboardService from './dashboard.service';
import {
  getReportDetail,
  REPORT_DETAIL_METRICS,
  ReportDetailMetric,
} from './report-detail.service';

export async function getStats(_req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await dashboardService.getDashboardStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

export async function getMyStats(req: Request, res: Response, next: NextFunction) {
  try {
    const { date } = req.query as Record<string, string>;
    // Always the caller's own figures — there is no employeeId parameter to widen the scope.
    res.json(await dashboardService.getMyDashboardStats(req.user!.userId, date));
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

export async function getReportsDetail(req: Request, res: Response, next: NextFunction) {
  try {
    const { metric, startDate, endDate, dealerId, employeeId } = req.query as Record<string, string>;
    if (!REPORT_DETAIL_METRICS.includes(metric as ReportDetailMetric)) {
      res.status(400).json({
        message: `Unknown metric. Expected one of: ${REPORT_DETAIL_METRICS.join(', ')}`,
      });
      return;
    }
    const detail = await getReportDetail({
      metric: metric as ReportDetailMetric,
      startDate,
      endDate,
      dealerId,
      employeeId,
    });
    res.json(detail);
  } catch (err) {
    next(err);
  }
}

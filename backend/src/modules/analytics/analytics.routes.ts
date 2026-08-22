import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  requireAnyReportOn,
  requireReportFrom,
} from '../../middleware/permission.middleware';
import * as controller from './analytics.controller';

const router = Router();

router.use(authMiddleware);

/**
 * Access is now the report layer's business, not a role list — see the per-route guards
 * below. Row visibility is still narrowed inside the service and is a separate concern:
 * admin sees everyone, a sales_manager sees their own reports, and any other role sees only
 * themselves. The report toggle says *whether* someone opens the report; the service still
 * decides *whose rows* are in it.
 *
 * Kept only for the Swagger examples further down.
 */
const ANY_STAFF = [
  'admin',
  'sales_manager',
  'employee',
  'order_taker',
  'warehouse_manager',
  'delivery_man',
] as const;

/**
 * @openapi
 * /api/analytics/performance:
 *   get:
 *     tags: [Analytics]
 *     summary: Per-employee performance vs monthly target
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: periodMonth
 *         schema: { type: string, example: "2026-07" }
 *         description: Defaults to the current month.
 *       - in: query
 *         name: employeeId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Performance report with kpis and per-employee rows }
 */
router.get('/performance', requireAnyReportOn('analytics.'), controller.performance);

/**
 * @openapi
 * /api/analytics/performance/detail:
 *   get:
 *     tags: [Analytics]
 *     summary: Drill-down rows behind a single performance KPI
 *     description: >
 *       Returns the records a KPI tile summed, plus column metadata to render them. Scope is the
 *       same as `/performance` — a rider sees only their own records. Capped at 5000 rows.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: metric
 *         required: true
 *         schema:
 *           type: string
 *           enum: [sales, target, achievement, booked, orders, visits-completed, overstays, new-clients, visit-completion, visits-skipped, extra-visits, total-visits-done, open-flags, days-present, collected, outstanding, collection-rate, returns, avg-order-value, strike-rate, tasks-done, achieved-target, behind-pace, below-visits]
 *       - in: query
 *         name: periodMonth
 *         schema: { type: string, example: "2026-07" }
 *       - in: query
 *         name: employeeId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Detail payload with columns, summary and rows }
 *       400: { description: Unknown metric }
 */
router.get(
  '/performance/detail',
  requireReportFrom((req) => 'analytics.' + String(req.query.metric ?? '')),
  controller.performanceDetail,
);

/**
 * @openapi
 * /api/analytics/trend:
 *   get:
 *     tags: [Analytics]
 *     summary: Month-by-month sales / orders / visits trend, with target line
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         schema: { type: string }
 *       - in: query
 *         name: months
 *         schema: { type: integer, default: 6, minimum: 1, maximum: 24 }
 *     responses:
 *       200: { description: Dense monthly series suitable for charting }
 */
router.get('/trend', requireAnyReportOn('analytics.'), controller.trend);

export default router;

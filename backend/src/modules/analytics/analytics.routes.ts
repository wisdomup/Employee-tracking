import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import * as controller from './analytics.controller';

const router = Router();

router.use(authMiddleware);

/**
 * Every authenticated role may call these. Visibility is narrowed inside the service:
 * admin sees everyone, a sales_manager sees their own reports, and any other role
 * sees only themselves. Requesting an employee outside your scope returns an empty
 * report rather than an error, so the UI can stay simple.
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
router.get('/performance', requireRoles(...ANY_STAFF), controller.performance);

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
router.get('/trend', requireRoles(...ANY_STAFF), controller.trend);

export default router;

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireReport } from '../../middleware/permission.middleware';
import * as controller from './region-sales.controller';

const router = Router();

router.use(authMiddleware);

/**
 * Admin and sales managers only — this is an oversight dashboard, riders have no reason
 * to see other people's regions. A sales manager's results are additionally narrowed to
 * their own team inside the service.
 */
const MANAGEMENT_ROLES = ['admin', 'sales_manager'] as const;

/**
 * @openapi
 * /api/region-sales/regions:
 *   get:
 *     tags: [Region Sales]
 *     summary: City-wise sale totals for a day or a date range
 *     description: >
 *       Regions are derived from each salesman's own city. Days are bounded in the
 *       report timezone (Asia/Karachi by default), not UTC. Regions with no sale in the
 *       window are still listed at zero. Pass `from`/`to` for a range or `date` for a
 *       single day; omitting everything gives today. Ranges are capped at 366 days.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-07-01" }
 *         description: Start of the window. Defaults to `to`, so a lone `to` is one day.
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-07-31" }
 *         description: End of the window. Defaults to today in the report timezone.
 *       - in: query
 *         name: date
 *         schema: { type: string, example: "2026-07-31" }
 *         description: Single-day shorthand, used when `from`/`to` are absent.
 *     responses:
 *       200: { description: "{ from, to, date, timezone, totals, regions[] }" }
 *       400: { description: Malformed date, reversed range, or a range over 366 days }
 */
router.get('/regions', requireReport('region-sales.daily'), controller.regions);

/**
 * @openapi
 * /api/region-sales/regions/{regionKey}/salesmen:
 *   get:
 *     tags: [Region Sales]
 *     summary: Every salesman in a region with their individual sale over the window
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: regionKey
 *         required: true
 *         schema: { type: string, example: "lahore" }
 *         description: Lowercased city name, or the literal "unassigned".
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-07-01" }
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-07-31" }
 *       - in: query
 *         name: date
 *         schema: { type: string, example: "2026-07-31" }
 *         description: Single-day shorthand, used when `from`/`to` are absent.
 *     responses:
 *       200: { description: "{ from, to, region, totals, salesmen[] } — includes zero-sale salesmen" }
 */
router.get(
  '/regions/:regionKey/salesmen',
  requireReport('region-sales.daily'),
  controller.regionSalesmen,
);

/**
 * @openapi
 * /api/region-sales/salesman/{employeeId}:
 *   get:
 *     tags: [Region Sales]
 *     summary: One salesman's day-wise sale over a date range
 *     description: >
 *       Returns a dense series — days with no orders come back as zero. Requesting an
 *       employee outside the caller's scope returns an empty report rather than 403.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, example: "2026-07-01" }
 *         description: Defaults to 6 days before `to`.
 *       - in: query
 *         name: to
 *         schema: { type: string, example: "2026-07-31" }
 *         description: Defaults to today in the report timezone.
 *     responses:
 *       200: { description: "{ from, to, employee, totals, days[] }" }
 *       400: { description: Malformed or oversized date range }
 */
router.get(
  '/salesman/:employeeId',
  requireReport('region-sales.daily'),
  controller.salesmanDaily,
);

export default router;

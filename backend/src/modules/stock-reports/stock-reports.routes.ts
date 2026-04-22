import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import * as controller from './stock-reports.controller';

const router = Router();

router.use(authMiddleware);
router.use(requireRoles('admin'));

/**
 * @openapi
 * /api/stock-reports/current:
 *   get:
 *     tags: [Stock Reports]
 *     summary: Current stock report — real-time inventory by product [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: categoryId
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: Current stock rows }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 */
router.get('/current', controller.getCurrentStock);

/**
 * @openapi
 * /api/stock-reports/hold:
 *   get:
 *     tags: [Stock Reports]
 *     summary: Hold stock report — stock reserved in active orders [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: categoryId
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: Hold stock rows }
 */
router.get('/hold', controller.getHoldStock);

/**
 * @openapi
 * /api/stock-reports/damage:
 *   get:
 *     tags: [Stock Reports]
 *     summary: Damage stock report — damaged inventory from returns [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: categoryId
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: Damage stock rows }
 */
router.get('/damage', controller.getDamageStock);

/**
 * @openapi
 * /api/stock-reports/profit-loss:
 *   get:
 *     tags: [Stock Reports]
 *     summary: Profit & Loss report — revenue vs costs in date range [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: P&L summary }
 */
router.get('/profit-loss', controller.getProfitLoss);

/**
 * @openapi
 * /api/stock-reports/low-stock:
 *   get:
 *     tags: [Stock Reports]
 *     summary: Low stock alert — products at or below survival quantity [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: categoryId
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: Low stock rows }
 */
router.get('/low-stock', controller.getLowStock);

export default router;

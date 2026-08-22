import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import * as controller from './performance-flags.controller';

const router = Router();

router.use(authMiddleware);

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
 * /api/performance-flags/summary:
 *   get:
 *     tags: [Performance Flags]
 *     summary: Open flag counts by type, scoped to the caller
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: "{ total, lowVisitCompletion, overstay }" }
 */
// Must stay above /:id-style routes.
router.get('/summary', requirePermission('performance-flags:view'), controller.summary);

/**
 * @openapi
 * /api/performance-flags:
 *   get:
 *     tags: [Performance Flags]
 *     summary: Riders flagged for review — admin sees all, a manager their team, a rider their own
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         schema: { type: string }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [low_visit_completion, overstay] }
 *       - in: query
 *         name: resolved
 *         schema: { type: boolean }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: Flags, unresolved first, newest first }
 */
router.get('/', requirePermission('performance-flags:view'), controller.findAll);

/**
 * @openapi
 * /api/performance-flags/{id}/resolve:
 *   patch:
 *     tags: [Performance Flags]
 *     summary: Mark a flag as reviewed [Admin, Sales manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Flag resolved }
 *       404: { description: Flag not found }
 */
router.patch('/:id/resolve', requirePermission('performance-flags:change'), controller.resolve);

export default router;

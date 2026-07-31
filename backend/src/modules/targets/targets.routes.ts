import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import { upsertTargetSchema } from './dto/targets.schemas';
import * as controller from './targets.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/targets:
 *   put:
 *     tags: [Targets]
 *     summary: Create or update a monthly target [Admin, Sales manager — own team]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeId, periodMonth]
 *             properties:
 *               employeeId: { type: string }
 *               periodMonth: { type: string, example: "2026-07" }
 *               salesAmount: { type: number }
 *               orderCount: { type: integer }
 *               visitCount: { type: integer }
 *               notes: { type: string }
 *     responses:
 *       200: { description: Target saved }
 *       400: { description: Validation error }
 *       403: { description: Not your team }
 */
router.put(
  '/',
  requireRoles('admin', 'sales_manager'),
  validate(upsertTargetSchema),
  controller.upsert,
);

/**
 * @openapi
 * /api/targets:
 *   get:
 *     tags: [Targets]
 *     summary: List targets visible to the caller
 *     description: >
 *       Admin sees all targets; a sales manager sees their own team's; every other role
 *       sees only their own. Optional `employeeId` outside the caller's scope returns [].
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         schema: { type: string }
 *       - in: query
 *         name: periodMonth
 *         schema: { type: string, example: "2026-07" }
 *     responses:
 *       200: { description: List of targets }
 */
router.get(
  '/',
  requireRoles('admin', 'sales_manager', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  controller.findAll,
);

/**
 * @openapi
 * /api/targets/{id}:
 *   delete:
 *     tags: [Targets]
 *     summary: Delete a target [Admin, Sales manager — own team]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Target deleted }
 *       403: { description: Not your team }
 *       404: { description: Target not found }
 */
router.delete('/:id', requireRoles('admin', 'sales_manager'), controller.remove);

export default router;

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createApprovalSchema,
  updateApprovalSchema,
  updateApprovalStatusSchema,
} from './dto/approvals.schemas';
import * as controller from './approvals.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/approvals:
 *   post:
 *     tags: [Approvals]
 *     summary: Submit an approval request [All authenticated roles]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [leaveDate]
 *             properties:
 *               approvalType:
 *                 type: string
 *                 enum: [leave, allowance, advance_salary, query, other]
 *               leaveType: { type: string, enum: [full_day, half_day, short_leave] }
 *               leaveReason: { type: string }
 *               leaveDate: { type: string, format: date }
 *     responses:
 *       201: { description: Created }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/', validate(createApprovalSchema), controller.create);

/**
 * @openapi
 * /api/approvals:
 *   get:
 *     tags: [Approvals]
 *     summary: List approval requests [Admin, order_taker]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected] }
 *       - in: query
 *         name: approvalType
 *         schema:
 *           type: string
 *           enum: [leave, allowance, advance_salary, query, other]
 *     responses:
 *       200: { description: List }
 *       401: { description: Unauthorized }
 */
router.get('/', requireRoles('admin', 'order_taker'), controller.findAll);

/**
 * @openapi
 * /api/approvals/{id}:
 *   get:
 *     tags: [Approvals]
 *     summary: Get approval by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Found }
 *       404: { description: Not found }
 */
router.get('/:id', controller.findOne);

/**
 * @openapi
 * /api/approvals/{id}:
 *   patch:
 *     tags: [Approvals]
 *     summary: Update approval [Admin, self pending only]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               approvalType:
 *                 type: string
 *                 enum: [leave, allowance, advance_salary, query, other]
 *               leaveType: { type: string, enum: [full_day, half_day, short_leave] }
 *               leaveReason: { type: string }
 *               leaveDate: { type: string, format: date }
 *     responses:
 *       200: { description: Updated }
 *       400: { description: Invalid state }
 *       404: { description: Not found }
 */
router.patch('/:id', validate(updateApprovalSchema), controller.update);

/**
 * @openapi
 * /api/approvals/{id}/status:
 *   patch:
 *     tags: [Approvals]
 *     summary: Approve or reject [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [approved, rejected] }
 *     responses:
 *       200: { description: Status updated }
 *       400: { description: Already processed }
 *       404: { description: Not found }
 */
router.patch(
  '/:id/status',
  requireRoles('admin'),
  validate(updateApprovalStatusSchema),
  controller.updateStatus,
);

/**
 * @openapi
 * /api/approvals/{id}:
 *   delete:
 *     tags: [Approvals]
 *     summary: Delete approval [Admin, self pending]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       400: { description: Cannot delete }
 *       404: { description: Not found }
 */
router.delete('/:id', requireRoles('admin', 'order_taker'), controller.remove);

export default router;

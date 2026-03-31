import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createLeaveSchema, updateLeaveSchema, updateLeaveStatusSchema } from './dto/leaves.schemas';
import * as controller from './leaves.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/leaves:
 *   post:
 *     tags: [Leaves]
 *     summary: Apply for a leave [All roles]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [leaveType, leaveDate]
 *             properties:
 *               leaveType: { type: string, enum: [full_day, half_day, short_leave] }
 *               leaveReason: { type: string }
 *               leaveDate: { type: string, format: date }
 *     responses:
 *       201: { description: Leave request created }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/', validate(createLeaveSchema), controller.create);

/**
 * @openapi
 * /api/leaves:
 *   get:
 *     tags: [Leaves]
 *     summary: Get all leave requests [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected] }
 *     responses:
 *       200: { description: List of leave requests }
 *       401: { description: Unauthorized }
 */
router.get('/', requireRoles('admin', 'order_taker'), controller.findAll);

/**
 * @openapi
 * /api/leaves/{id}:
 *   get:
 *     tags: [Leaves]
 *     summary: Get a leave request by ID [Admin, All roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Leave request found }
 *       404: { description: Leave not found }
 */
router.get('/:id', controller.findOne);

/**
 * @openapi
 * /api/leaves/{id}:
 *   patch:
 *     tags: [Leaves]
 *     summary: Update a leave request [Admin, Self - pending only]
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
 *               leaveType: { type: string, enum: [full_day, half_day, short_leave] }
 *               leaveReason: { type: string }
 *               leaveDate: { type: string, format: date }
 *     responses:
 *       200: { description: Leave updated }
 *       400: { description: Only pending leaves can be edited }
 *       404: { description: Leave not found }
 */
router.patch('/:id', validate(updateLeaveSchema), controller.update);

/**
 * @openapi
 * /api/leaves/{id}/status:
 *   patch:
 *     tags: [Leaves]
 *     summary: Approve or reject a leave request [Admin]
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
 *       200: { description: Leave status updated }
 *       400: { description: Leave already processed }
 *       404: { description: Leave not found }
 */
router.patch('/:id/status', requireRoles('admin'), validate(updateLeaveStatusSchema), controller.updateStatus);

/**
 * @openapi
 * /api/leaves/{id}:
 *   delete:
 *     tags: [Leaves]
 *     summary: Delete a leave request [Admin, Self]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Leave deleted }
 *       400: { description: Cannot delete approved leave }
 *       404: { description: Leave not found }
 */
router.delete('/:id', requireRoles('admin', 'order_taker'), controller.remove);

export default router;

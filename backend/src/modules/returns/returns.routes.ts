import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createReturnSchema, updateReturnSchema } from './dto/returns.schemas';
import * as controller from './returns.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/returns:
 *   post:
 *     tags: [Returns]
 *     summary: Create a return or claim [Admin, Employee, Order Taker]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId, dealerId, returnType]
 *             properties:
 *               productId: { type: string }
 *               dealerId: { type: string }
 *               returnType: { type: string, enum: [return, claim] }
 *               returnReason: { type: string }
 *     responses:
 *       201: { description: Return created }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post(
  '/',
  requireRoles('admin', 'employee', 'order_taker'),
  validate(createReturnSchema),
  controller.create,
);

/**
 * @openapi
 * /api/returns:
 *   get:
 *     tags: [Returns]
 *     summary: Get all returns [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dealerId
 *         schema: { type: string }
 *       - in: query
 *         name: productId
 *         schema: { type: string }
 *       - in: query
 *         name: returnType
 *         schema: { type: string, enum: [return, claim] }
 *       - in: query
 *         name: createdBy
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of returns }
 *       401: { description: Unauthorized }
 */
router.get('/', requireRoles('admin', 'employee', 'order_taker'), controller.findAll);

/**
 * @openapi
 * /api/returns/{id}:
 *   get:
 *     tags: [Returns]
 *     summary: Get a return by ID [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Return found }
 *       404: { description: Return not found }
 */
router.get('/:id', requireRoles('admin', 'employee', 'order_taker'), controller.findOne);

/**
 * @openapi
 * /api/returns/{id}:
 *   put:
 *     tags: [Returns]
 *     summary: Update a return [Admin]
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
 *             properties:
 *               returnType: { type: string, enum: [return, claim] }
 *               returnReason: { type: string }
 *     responses:
 *       200: { description: Return updated }
 *       404: { description: Return not found }
 */
router.put('/:id', requireRoles('admin'), validate(updateReturnSchema), controller.update);

/**
 * @openapi
 * /api/returns/{id}:
 *   delete:
 *     tags: [Returns]
 *     summary: Delete a return [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Return deleted }
 *       404: { description: Return not found }
 */
router.delete('/:id', requireRoles('admin'), controller.remove);

export default router;

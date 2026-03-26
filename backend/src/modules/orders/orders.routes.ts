import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createOrderSchema, updateOrderSchema } from './dto/orders.schemas';
import * as controller from './orders.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/orders:
 *   post:
 *     tags: [Orders]
 *     summary: Create a new order [Admin, Employee, Order Taker]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [products, dealerId]
 *             properties:
 *               products:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId: { type: string }
 *                     quantity: { type: number }
 *                     price: { type: number }
 *               totalPrice: { type: number }
 *               discount: { type: number }
 *               grandTotal: { type: number }
 *               paidAmount: { type: number }
 *               dealerId: { type: string }
 *               routeId: { type: string }
 *               status: { type: string, enum: [pending, approved, packed, dispatched, delivered, cancelled] }
 *     responses:
 *       201: { description: Order created }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post(
  '/',
  requireRoles('admin', 'employee', 'order_taker'),
  validate(createOrderSchema),
  controller.create,
);

/**
 * @openapi
 * /api/orders:
 *   get:
 *     tags: [Orders]
 *     summary: Get all orders [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dealerId
 *         schema: { type: string }
 *       - in: query
 *         name: routeId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, packed, dispatched, delivered, cancelled] }
 *       - in: query
 *         name: createdBy
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of orders }
 *       401: { description: Unauthorized }
 */
router.get('/', requireRoles('admin', 'employee', 'order_taker'), controller.findAll);

/**
 * @openapi
 * /api/orders/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Get an order by ID [Admin, Employee, Order Taker]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Order found }
 *       404: { description: Order not found }
 */
router.get('/:id', requireRoles('admin', 'employee', 'order_taker'), controller.findOne);

/**
 * @openapi
 * /api/orders/{id}:
 *   put:
 *     tags: [Orders]
 *     summary: Update an order [Admin, Employee, Order Taker]
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
 *               status: { type: string, enum: [pending, approved, packed, dispatched, delivered, cancelled] }
 *     responses:
 *       200: { description: Order updated }
 *       404: { description: Order not found }
 */
router.put(
  '/:id',
  requireRoles('admin', 'employee', 'order_taker'),
  validate(updateOrderSchema),
  controller.update,
);

/**
 * @openapi
 * /api/orders/{id}/approve:
 *   patch:
 *     tags: [Orders]
 *     summary: Approve a pending order [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Order approved }
 *       400: { description: Order is not pending }
 *       404: { description: Order not found }
 */
router.patch('/:id/approve', requireRoles('admin'), controller.approve);

/**
 * @openapi
 * /api/orders/{id}:
 *   delete:
 *     tags: [Orders]
 *     summary: Delete an order [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Order deleted }
 *       404: { description: Order not found }
 */
router.delete('/:id', requireRoles('admin'), controller.remove);
router.patch('/:id/restore', requireRoles('admin'), controller.restore);
router.delete('/:id/permanent', requireRoles('admin'), controller.removePermanent);

export default router;

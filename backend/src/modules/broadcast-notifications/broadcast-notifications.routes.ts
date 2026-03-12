import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createBroadcastNotificationSchema,
  updateBroadcastNotificationSchema,
} from './dto/broadcast-notifications.schemas';
import * as controller from './broadcast-notifications.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/broadcast-notifications:
 *   post:
 *     tags: [Broadcast Notifications]
 *     summary: Create a broadcast notification [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, broadcastTo]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               broadcastTo: { type: string, enum: [all, employees, dealers, customers] }
 *               startAt: { type: string, format: date-time }
 *               endAt: { type: string, format: date-time }
 *     responses:
 *       201: { description: Notification created }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post(
  '/',
  requireRoles('admin'),
  validate(createBroadcastNotificationSchema),
  controller.create,
);

/**
 * @openapi
 * /api/broadcast-notifications:
 *   get:
 *     tags: [Broadcast Notifications]
 *     summary: Get all broadcast notifications [All roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: broadcastTo
 *         schema: { type: string, enum: [all, employees, dealers, customers] }
 *     responses:
 *       200: { description: List of notifications }
 *       401: { description: Unauthorized }
 */
router.get('/', controller.findAll);

/**
 * @openapi
 * /api/broadcast-notifications/{id}:
 *   get:
 *     tags: [Broadcast Notifications]
 *     summary: Get a broadcast notification by ID [All roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Notification found }
 *       404: { description: Notification not found }
 */
router.get('/:id', controller.findOne);

/**
 * @openapi
 * /api/broadcast-notifications/{id}:
 *   put:
 *     tags: [Broadcast Notifications]
 *     summary: Update a broadcast notification [Admin]
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
 *               title: { type: string }
 *               description: { type: string }
 *               broadcastTo: { type: string, enum: [all, employees, dealers, customers] }
 *               startAt: { type: string, format: date-time }
 *               endAt: { type: string, format: date-time }
 *     responses:
 *       200: { description: Notification updated }
 *       404: { description: Notification not found }
 */
router.put(
  '/:id',
  requireRoles('admin'),
  validate(updateBroadcastNotificationSchema),
  controller.update,
);

/**
 * @openapi
 * /api/broadcast-notifications/{id}:
 *   delete:
 *     tags: [Broadcast Notifications]
 *     summary: Delete a broadcast notification [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Notification deleted }
 *       404: { description: Notification not found }
 */
router.delete('/:id', requireRoles('admin'), controller.remove);

export default router;

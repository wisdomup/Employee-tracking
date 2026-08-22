import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
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
 */
router.post(
  '/',
  requirePermission('broadcast-notifications:add'),
  validate(createBroadcastNotificationSchema),
  controller.create,
);

/**
 * @openapi
 * /api/broadcast-notifications:
 *   get:
 *     tags: [Broadcast Notifications]
 *     summary: List all broadcast notifications [Admin only]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', requirePermission('broadcast-notifications:view'), controller.findAll);

/**
 * @openapi
 * /api/broadcast-notifications/inbox:
 *   get:
 *     tags: [Broadcast Notifications]
 *     summary: Inbox for current user (visibility + active window + read state)
 *     security:
 *       - bearerAuth: []
 */
router.get('/inbox', controller.inbox);

/**
 * @openapi
 * /api/broadcast-notifications/{id}/read:
 *   patch:
 *     tags: [Broadcast Notifications]
 *     summary: Mark notification as read (recipient only, active window)
 *     security:
 *       - bearerAuth: []
 */
router.patch('/:id/read', controller.markRead);

/**
 * @openapi
 * /api/broadcast-notifications/{id}:
 *   get:
 *     tags: [Broadcast Notifications]
 *     summary: Get by ID (admin any; others only if recipient and active)
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', controller.findOne);

/**
 * @openapi
 * /api/broadcast-notifications/{id}:
 *   put:
 *     tags: [Broadcast Notifications]
 *     summary: Update [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  '/:id',
  requirePermission('broadcast-notifications:edit'),
  validate(updateBroadcastNotificationSchema),
  controller.update,
);

/**
 * @openapi
 * /api/broadcast-notifications/{id}:
 *   delete:
 *     tags: [Broadcast Notifications]
 *     summary: Delete [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:id', requirePermission('broadcast-notifications:delete'), controller.remove);

export default router;

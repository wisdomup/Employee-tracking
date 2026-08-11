import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createVisitSchema,
  createVisitsForRouteSchema,
  bulkCreateVisitsSchema,
  completeVisitSchema,
  checkInVisitSchema,
  updateVisitSchema,
  updateVisitGallerySchema,
  skipVisitSchema,
} from './dto/visits.schemas';
import * as controller from './visits.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/visits:
 *   post:
 *     tags: [Visits]
 *     summary: Create a visit record [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dealerId, employeeId]
 *             properties:
 *               dealerId: { type: string }
 *               employeeId: { type: string }
 *               routeId: { type: string }
 *               visitDate: { type: string, format: date-time }
 *               status: { type: string, enum: [todo, in_progress, completed, incomplete, cancelled] }
 *     responses:
 *       201: { description: Visit created }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/', requireRoles('admin', 'employee'), validate(createVisitSchema), controller.create);

router.post(
  '/create-for-route',
  requireRoles('admin', 'employee'),
  validate(createVisitsForRouteSchema),
  controller.createForRoute,
);

/**
 * @openapi
 * /api/visits/bulk:
 *   post:
 *     tags: [Visits]
 *     summary: Assign one employee to visit multiple clients on a given day [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeId, visitDate, dealerIds]
 *             properties:
 *               employeeId: { type: string }
 *               visitDate: { type: string, format: date-time }
 *               dealerIds: { type: array, items: { type: string } }
 *               routeId: { type: string }
 *     responses:
 *       201: { description: Visits created }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/bulk', requireRoles('admin', 'employee'), validate(bulkCreateVisitsSchema), controller.bulkCreate);

/**
 * @openapi
 * /api/visits:
 *   get:
 *     tags: [Visits]
 *     summary: Get all visits [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dealerId
 *         schema: { type: string }
 *       - in: query
 *         name: employeeId
 *         schema: { type: string }
 *       - in: query
 *         name: routeId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [todo, in_progress, completed, incomplete, cancelled] }
 *     responses:
 *       200: { description: List of visits }
 *       401: { description: Unauthorized }
 */
router.get(
  '/',
  requireRoles('admin', 'sales_manager', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  controller.findAll,
);

/**
 * @openapi
 * /api/visits/gallery:
 *   get:
 *     tags: [Visits]
 *     summary: Shop photo gallery for a client, with the rider who captured each entry
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dealerId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Gallery entries }
 *       400: { description: dealerId is required }
 */
// NOTE: must stay above `GET /:id`, otherwise "gallery" is parsed as a visit id.
router.get(
  '/gallery',
  requireRoles('admin', 'sales_manager', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  controller.dealerGallery,
);

/**
 * @openapi
 * /api/visits/last:
 *   get:
 *     tags: [Visits]
 *     summary: The most recent completed visit to a client, and how many days ago it was
 *     description: >
 *       Only `completed` visits count — that is the only status meaning a rider physically
 *       checked in and out at the shop. Returns `{ visit: null, daysAgo: null }` when the
 *       client has never been visited.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dealerId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Last visit and its age in days }
 *       400: { description: dealerId is required }
 */
// NOTE: must stay above `GET /:id`, otherwise "last" is parsed as a visit id.
router.get(
  '/last',
  requireRoles('admin', 'sales_manager', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  controller.dealerLastVisit,
);

/**
 * @openapi
 * /api/visits/{id}/complete:
 *   patch:
 *     tags: [Visits]
 *     summary: Complete a visit with GPS and images [Admin, Employee, Order taker — own visit only]
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
 *             required: [latitude, longitude, completionImages]
 *     responses:
 *       200: { description: Visit completed }
 *       400: { description: Validation or business rule error }
 *       403: { description: Forbidden }
 */
router.patch(
  '/:id/complete',
  requireRoles('admin', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  validate(completeVisitSchema),
  controller.completeVisit,
);

/**
 * @openapi
 * /api/visits/{id}/check-in:
 *   patch:
 *     tags: [Visits]
 *     summary: Check in at a visit location [Employee, Order taker, Delivery man]
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
 *             required: [latitude, longitude]
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       200: { description: Checked in successfully }
 *       400: { description: Too far from store or invalid state }
 */
router.patch(
  '/:id/check-in',
  requireRoles('admin', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  validate(checkInVisitSchema),
  controller.checkInVisit,
);

/**
 * @openapi
 * /api/visits/self:
 *   post:
 *     tags: [Visits]
 *     summary: Start a visit for any client the rider can see, without a route assignment
 *     description: >
 *       Creates a visit assigned to the caller for the given client, marked as
 *       self-initiated. The resulting visit behaves exactly like an assigned one —
 *       same geofenced check-in, checkout requirements, duration tracking and gallery.
 *       Idempotent per day: if a visit for this rider and client already exists today it
 *       is returned (200) instead of creating a duplicate (201).
 *       Clients outside the rider's own city are not found, matching the client list.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dealerId]
 *             properties:
 *               dealerId: { type: string }
 *     responses:
 *       201: { description: "New visit created — { visit, created: true }" }
 *       200: { description: "Today's existing visit returned — { visit, created: false }" }
 *       400: { description: dealerId missing or malformed }
 *       404: { description: Client not found or outside your city }
 */
router.post(
  '/self',
  requireRoles('admin', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  controller.startSelfVisit,
);

/**
 * @openapi
 * /api/visits/{id}/skip-preview:
 *   get:
 *     tags: [Visits]
 *     summary: What skipping this visit would do to today's completion rate (read-only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: >
 *           currentRate, projectedRate, threshold, wouldDropBelowThreshold and the
 *           day's tally. Nothing is modified.
 */
router.get(
  '/:id/skip-preview',
  requireRoles('admin', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  controller.previewSkip,
);

/**
 * @openapi
 * /api/visits/{id}/skip:
 *   patch:
 *     tags: [Visits]
 *     summary: Skip a visit on the route [own visit]
 *     description: >
 *       Two-step. If skipping would leave the day below the required completion rate and
 *       `confirm` is not set, NOTHING is written and the response has
 *       `requiresConfirmation: true` with the projected rate. Re-send with
 *       `confirm: true` to go ahead — which raises an admin flag against the rider.
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
 *               reason: { type: string }
 *               confirm: { type: boolean }
 *     responses:
 *       200: { description: Skipped, or a confirmation request }
 *       400: { description: Visit cannot be skipped in its current status }
 */
router.patch(
  '/:id/skip',
  requireRoles('admin', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  validate(skipVisitSchema),
  controller.skipVisit,
);

/**
 * @openapi
 * /api/visits/{id}/gallery:
 *   patch:
 *     tags: [Visits]
 *     summary: Add optional shop photos and notes after checkout [own completed visit]
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
 *               galleryImages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     url: { type: string }
 *                     caption: { type: string }
 *               visitNotes: { type: string }
 *     responses:
 *       200: { description: Gallery updated }
 *       400: { description: Visit not completed or not assigned to you }
 */
router.patch(
  '/:id/gallery',
  requireRoles('admin', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  validate(updateVisitGallerySchema),
  controller.updateGallery,
);

/**
 * @openapi
 * /api/visits/{id}:
 *   get:
 *     tags: [Visits]
 *     summary: Get a visit by ID [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Visit found }
 *       404: { description: Visit not found }
 */
router.get(
  '/:id',
  requireRoles('admin', 'sales_manager', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  controller.findOne,
);

/**
 * @openapi
 * /api/visits/{id}:
 *   put:
 *     tags: [Visits]
 *     summary: Update a visit [Admin, Employee]
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
 *               status: { type: string, enum: [todo, in_progress, completed, incomplete, cancelled] }
 *               visitDate: { type: string, format: date-time }
 *     responses:
 *       200: { description: Visit updated }
 *       404: { description: Visit not found }
 */
router.put(
  '/:id',
  requireRoles('admin', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  validate(updateVisitSchema),
  controller.update,
);

/**
 * @openapi
 * /api/visits/{id}:
 *   delete:
 *     tags: [Visits]
 *     summary: Delete a visit [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Visit deleted }
 *       404: { description: Visit not found }
 */
router.delete('/:id', requireRoles('admin'), controller.remove);
router.patch('/:id/restore', requireRoles('admin'), controller.restore);
router.delete('/:id/permanent', requireRoles('admin'), controller.removePermanent);

export default router;

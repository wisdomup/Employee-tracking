import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createVisitSchema, createVisitsForRouteSchema, completeVisitSchema, updateVisitSchema } from './dto/visits.schemas';
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
router.get('/', requireRoles('admin', 'employee'), controller.findAll);

router.patch(
  '/:id/complete',
  requireRoles('admin', 'employee'),
  validate(completeVisitSchema),
  controller.completeVisit,
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
router.get('/:id', requireRoles('admin', 'employee'), controller.findOne);

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
router.put('/:id', requireRoles('admin', 'employee'), validate(updateVisitSchema), controller.update);

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

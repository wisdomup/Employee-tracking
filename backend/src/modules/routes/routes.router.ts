import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createRouteSchema, updateRouteSchema } from './dto/routes.schemas';
import * as controller from './routes.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/routes:
 *   post:
 *     tags: [Routes]
 *     summary: Create a new route [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, startingPoint, endingPoint]
 *             properties:
 *               name: { type: string, example: Gulberg Route }
 *               startingPoint: { type: string, example: Main Boulevard }
 *               endingPoint: { type: string, example: Liberty Market }
 *     responses:
 *       201:
 *         description: Route created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Route'
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/', requireRoles('admin', 'employee'), validate(createRouteSchema), controller.create);

/**
 * @openapi
 * /api/routes:
 *   get:
 *     tags: [Routes]
 *     summary: Get all routes with optional search [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search routes by name, starting point or ending point (partial match)
 *     responses:
 *       200:
 *         description: List of routes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Route'
 *       401: { description: Unauthorized }
 */
router.get('/', requireRoles('admin', 'employee', 'order_taker'), controller.findAll);

/**
 * @openapi
 * /api/routes/{id}:
 *   get:
 *     tags: [Routes]
 *     summary: Get a route by ID [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the route
 *     responses:
 *       200:
 *         description: Returns the route
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Route'
 *       401: { description: Unauthorized }
 *       404: { description: Route not found }
 */
router.get('/:id', requireRoles('admin', 'employee', 'order_taker'), controller.findOne);

/**
 * @openapi
 * /api/routes/{id}:
 *   put:
 *     tags: [Routes]
 *     summary: Update a route by ID [Admin, Employee]
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
 *               name: { type: string }
 *               startingPoint: { type: string }
 *               endingPoint: { type: string }
 *     responses:
 *       200:
 *         description: Route updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Route'
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       404: { description: Route not found }
 */
router.put('/:id', requireRoles('admin', 'employee'), validate(updateRouteSchema), controller.update);

/**
 * @openapi
 * /api/routes/{id}:
 *   delete:
 *     tags: [Routes]
 *     summary: Delete a route by ID [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Route deleted successfully }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — admin role required }
 *       404: { description: Route not found }
 */
router.delete('/:id', requireRoles('admin'), controller.remove);
router.patch('/:id/restore', requireRoles('admin'), controller.restore);
router.delete('/:id/permanent', requireRoles('admin'), controller.removePermanent);

export default router;

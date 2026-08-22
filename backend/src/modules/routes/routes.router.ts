import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
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
router.post('/', requirePermission('routes:add'), validate(createRouteSchema), controller.create);

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
router.get('/', requirePermission('routes:view'), controller.findAll);

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
router.get('/:id', requirePermission('routes:view'), controller.findOne);

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
router.put('/:id', requirePermission('routes:edit'), validate(updateRouteSchema), controller.update);

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
router.delete('/:id', requirePermission('routes:delete'), controller.remove);
router.patch('/:id/restore', requirePermission('trash:change'), controller.restore);
router.delete('/:id/permanent', requirePermission('trash:delete'), controller.removePermanent);

export default router;

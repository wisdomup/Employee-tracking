import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import { assignRouteSchema } from './dto/route-assignments.schemas';
import * as controller from './route-assignments.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/route-assignments:
 *   post:
 *     tags: [Route Assignments]
 *     summary: Assign a route to an employee [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [routeId, employeeId]
 *             properties:
 *               routeId: { type: string, example: 64a7f3c2e4b0c123456789ef }
 *               employeeId: { type: string, example: 64a7f3c2e4b0c123456789ef }
 *     responses:
 *       201:
 *         description: Route assigned successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RouteAssignment'
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — admin role required }
 *       404: { description: Route or employee not found }
 */
router.post('/', requireRoles('admin'), validate(assignRouteSchema), controller.assignRoute);

/**
 * @openapi
 * /api/route-assignments:
 *   get:
 *     tags: [Route Assignments]
 *     summary: Get all route assignments [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all route assignments with populated route and employee details
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/RouteAssignment'
 *       401: { description: Unauthorized }
 */
router.get('/', requireRoles('admin', 'employee'), controller.findAll);

/**
 * @openapi
 * /api/route-assignments/route/{routeId}:
 *   get:
 *     tags: [Route Assignments]
 *     summary: Get the assignment for a specific route [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: routeId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the route
 *     responses:
 *       200:
 *         description: Returns the route assignment
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RouteAssignment'
 *       401: { description: Unauthorized }
 *       404: { description: No assignment found for this route }
 */
router.get('/route/:routeId', requireRoles('admin', 'employee'), controller.findByRoute);

/**
 * @openapi
 * /api/route-assignments/employee/{employeeId}:
 *   get:
 *     tags: [Route Assignments]
 *     summary: Get all routes assigned to a specific employee [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the employee
 *     responses:
 *       200:
 *         description: List of route assignments for the employee
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/RouteAssignment'
 *       401: { description: Unauthorized }
 */
router.get('/employee/:employeeId', requireRoles('admin', 'employee'), controller.findByEmployee);

/**
 * @openapi
 * /api/route-assignments/route/{routeId}:
 *   delete:
 *     tags: [Route Assignments]
 *     summary: Unassign (remove) a route assignment [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: routeId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the route to unassign
 *     responses:
 *       200: { description: Route unassigned successfully }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — admin role required }
 *       404: { description: No assignment found for this route }
 */
router.delete('/route/:routeId', requireRoles('admin'), controller.unassignRoute);

export default router;

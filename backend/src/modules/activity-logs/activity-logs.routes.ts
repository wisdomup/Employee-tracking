import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import * as controller from './activity-logs.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/activity-logs:
 *   get:
 *     tags: [Activity Logs]
 *     summary: Get all activity logs with optional filters [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         schema: { type: string }
 *         description: Filter logs by employee MongoDB ObjectId
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *         description: Filter logs from this date (ISO 8601, e.g. 2024-01-01)
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *         description: Filter logs up to this date (ISO 8601, e.g. 2024-12-31)
 *     responses:
 *       200:
 *         description: List of activity log entries with populated employee and task assignment
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ActivityLog'
 *       401: { description: Unauthorized }
 */
router.get('/', requireRoles('admin', 'employee'), controller.findAll);

/**
 * @openapi
 * /api/activity-logs/recent:
 *   get:
 *     tags: [Activity Logs]
 *     summary: Get the most recent activity log entries [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *         description: Maximum number of entries to return (default 10)
 *     responses:
 *       200:
 *         description: Most recent activity log entries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ActivityLog'
 *       401: { description: Unauthorized }
 */
router.get('/recent', requireRoles('admin', 'employee'), controller.getRecent);

/**
 * @openapi
 * /api/activity-logs/employee/{id}:
 *   get:
 *     tags: [Activity Logs]
 *     summary: Get activity logs for a specific employee [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the employee
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Activity logs for the specified employee
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ActivityLog'
 *       401: { description: Unauthorized }
 *       404: { description: Employee not found }
 */
router.get('/employee/:id', requireRoles('admin', 'employee'), controller.findByEmployee);

export default router;

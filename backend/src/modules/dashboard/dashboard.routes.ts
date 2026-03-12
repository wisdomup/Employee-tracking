import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import * as controller from './dashboard.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/dashboard/stats:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get aggregated dashboard statistics [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Summary counts for tasks, dealers, employees and recent activity
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalEmployees: { type: number, example: 12 }
 *                     totalDealers: { type: number, example: 40 }
 *                     totalTasks: { type: number, example: 120 }
 *                     tasksCompletedToday: { type: number, example: 8 }
 *                     tasksInProgress: { type: number, example: 5 }
 *                 recentActivity:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ActivityLog'
 *                 completedTasksForMap:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       taskName: { type: string }
 *                       employeeName: { type: string }
 *                       dealerLocation:
 *                         type: object
 *                         properties:
 *                           latitude: { type: number }
 *                           longitude: { type: number }
 *                           name: { type: string }
 *                       completionLocation:
 *                         type: object
 *                         properties:
 *                           latitude: { type: number }
 *                           longitude: { type: number }
 *                       completedAt: { type: string, format: date-time }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — admin role required }
 */
router.get('/stats', requireRoles('admin'), controller.getStats);

export default router;

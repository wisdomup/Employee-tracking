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
 *                     activeEmployees: { type: number, example: 12 }
 *                     inactiveEmployees: { type: number, example: 3 }
 *                     totalClients: { type: number, example: 40 }
 *                     totalTasks: { type: number, example: 120 }
 *                     tasksCompletedToday: { type: number, example: 8 }
 *                     tasksInProgress: { type: number, example: 5 }
 *                     totalProducts: { type: number, example: 80 }
 *                     totalCategories: { type: number, example: 10 }
 *                     totalOrders: { type: number, example: 200 }
 *                     totalPendingOrders: { type: number, example: 15 }
 *                     totalRoutes: { type: number, example: 8 }
 *                     visitsToday: { type: number, example: 46 }
 *                     visitsCompletedToday: { type: number, example: 31 }
 *                     visitsOpenToday: { type: number, example: 12 }
 *                     ordersToday: { type: number, example: 22 }
 *                     deliveredSalesToday: { type: number, example: 184500.5 }
 *                     bookedSalesToday: { type: number, example: 61200 }
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

/**
 * @openapi
 * /api/dashboard/my-stats:
 *   get:
 *     tags: [Dashboard]
 *     summary: The signed-in user's own visit, task and sale counts for one day
 *     description: >
 *       Backs the salesman dashboard cards. Every figure is aggregated in the database and
 *       scoped to a single day, so the visit counts and the task counts answer the same
 *       question — the page used to fetch both lists and filter them in the browser, which
 *       left the task counts covering the rider's entire history. Always the caller's own
 *       data; there is no employee parameter.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *         description: Defaults to today.
 *     responses:
 *       200: { description: "{ date, visits{}, tasks{}, sales{} }" }
 *       401: { description: Unauthorized }
 */
router.get(
  '/my-stats',
  requireRoles(
    'admin',
    'sales_manager',
    'employee',
    'order_taker',
    'delivery_man',
    'warehouse_manager',
    'warehouse_staff',
  ),
  controller.getMyStats,
);

/**
 * @openapi
 * /api/dashboard/reports:
 *   get:
 *     tags: [Dashboard]
 *     summary: Get dashboard reports with stock and sales analytics [Admin]
 *     description: Hold stock includes pending/approved/packed/dispatched orders. Return metrics expose returned vs damaged quantities.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: groupBy
 *         schema: { type: string, enum: [day, month, year] }
 *       - in: query
 *         name: viewBy
 *         schema: { type: string, enum: [item, category] }
 *     responses:
 *       200: { description: Report payload with KPIs, trends, and stock breakdowns }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — admin role required }
 */
router.get('/reports', requireRoles('admin'), controller.getReports);

export default router;

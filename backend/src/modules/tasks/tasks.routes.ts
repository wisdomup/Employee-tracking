import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import { uploadTaskDocumentSingle } from '../../middleware/upload.middleware';
import {
  createTaskSchema,
  updateTaskSchema,
  assignTaskSchema,
  startTaskSchema,
  completeTaskSchema,
} from './dto/tasks.schemas';
import * as controller from './tasks.controller';

const router = Router();

router.use(authMiddleware);

function optionalTaskDocument(req: Request, res: Response, next: NextFunction) {
  uploadTaskDocumentSingle(req, res, (err: unknown) => {
    if (err) {
      return res.status(400).json({
        message: err instanceof Error ? err.message : 'Invalid document file',
      });
    }
    next();
  });
}

/**
 * @openapi
 * /api/tasks:
 *   post:
 *     tags: [Tasks]
 *     summary: Create a new task [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [taskName]
 *             properties:
 *               taskName: { type: string, example: Deliver stock }
 *               description: { type: string }
 *               referenceImage: { type: string }
 *               quantity: { type: number, example: 10 }
 *               dealerId: { type: string }
 *               routeId: { type: string }
 *     responses:
 *       201: { description: Task created successfully }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/', requireRoles('admin', 'employee'), optionalTaskDocument, validate(createTaskSchema), controller.create);

/**
 * @openapi
 * /api/tasks:
 *   get:
 *     tags: [Tasks]
 *     summary: Get all tasks with optional filters [Admin, Employee, Order taker, Warehouse manager, Delivery man]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dealerId
 *         schema: { type: string }
 *       - in: query
 *         name: routeId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, in_progress, completed] }
 *       - in: query
 *         name: assignedTo
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of tasks }
 *       401: { description: Unauthorized }
 */
router.get(
  '/',
  requireRoles('admin', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  controller.findAll,
);

/**
 * @openapi
 * /api/tasks/{id}:
 *   get:
 *     tags: [Tasks]
 *     summary: Get a task by ID [Admin, Employee, Order taker, Warehouse manager, Delivery man]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Task found }
 *       401: { description: Unauthorized }
 *       404: { description: Task not found }
 */
router.get(
  '/:id',
  requireRoles('admin', 'employee', 'order_taker', 'warehouse_manager', 'delivery_man'),
  controller.findOne,
);

/**
 * @openapi
 * /api/tasks/{id}:
 *   put:
 *     tags: [Tasks]
 *     summary: Update a task by ID [Admin, Employee]
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
 *               taskName: { type: string }
 *               description: { type: string }
 *               referenceImage: { type: string }
 *               quantity: { type: number }
 *               dealerId: { type: string }
 *               routeId: { type: string }
 *     responses:
 *       200: { description: Task updated }
 *       401: { description: Unauthorized }
 *       404: { description: Task not found }
 */
router.put('/:id', requireRoles('admin', 'employee'), optionalTaskDocument, validate(updateTaskSchema), controller.update);

/**
 * @openapi
 * /api/tasks/{id}:
 *   delete:
 *     tags: [Tasks]
 *     summary: Delete a task by ID [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Task deleted }
 *       400: { description: Cannot delete task in progress }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 *       404: { description: Task not found }
 */
router.delete('/:id', requireRoles('admin'), controller.remove);

/**
 * @openapi
 * /api/tasks/{id}/assign:
 *   patch:
 *     tags: [Tasks]
 *     summary: Assign a task to an employee [Admin, Employee]
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
 *             required: [assignedTo]
 *             properties:
 *               assignedTo: { type: string, description: Employee user ID }
 *     responses:
 *       200: { description: Task assigned successfully }
 *       400: { description: Cannot reassign in-progress task }
 *       401: { description: Unauthorized }
 *       404: { description: Task or employee not found }
 */
router.patch(
  '/:id/assign',
  requireRoles('admin', 'employee'),
  validate(assignTaskSchema),
  controller.assignTask,
);

/**
 * @openapi
 * /api/tasks/{id}/start:
 *   patch:
 *     tags: [Tasks]
 *     summary: Start a task (employee marks task as in_progress) [All roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *             description: All fields optional; empty body is allowed.
 *     responses:
 *       200: { description: Task started }
 *       400: { description: Task not in pending status or not assigned to you }
 *       401: { description: Unauthorized }
 *       404: { description: Task not found }
 */
router.patch('/:id/start', validate(startTaskSchema), controller.startTask);

/**
 * @openapi
 * /api/tasks/{id}/complete:
 *   patch:
 *     tags: [Tasks]
 *     summary: Complete a task [All roles]; GPS and completion images optional
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               completionImages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [type, url]
 *                   properties:
 *                     type: { type: string, enum: [shop, selfie] }
 *                     url: { type: string }
 *             description: All fields optional; empty body marks complete without extras.
 *     responses:
 *       200: { description: Task completed }
 *       400: { description: Task already completed or not assigned to you }
 *       401: { description: Unauthorized }
 *       404: { description: Task not found }
 */
router.patch('/:id/complete', validate(completeTaskSchema), controller.completeTask);

export default router;

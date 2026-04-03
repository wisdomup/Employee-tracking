import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createUserSchema, updateUserSchema, updateProfileSchema } from './dto/users.schemas';
import * as controller from './users.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/users:
 *   post:
 *     tags: [Users]
 *     summary: Create a new user [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, phone, password, role]
 *             properties:
 *               username: { type: string, example: jane_doe }
 *               phone: { type: string, example: '03009876543' }
 *               email: { type: string, example: jane@example.com }
 *               password: { type: string, minLength: 6, example: secret123 }
 *               role:
 *                 type: string
 *                 enum: [admin, employee, warehouse_manager, order_taker, delivery_man]
 *               isActive: { type: boolean }
 *               address: { $ref: '#/components/schemas/Address' }
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — admin role required }
 *       409: { description: Username or phone already exists }
 */
router.post('/', requireRoles('admin'), validate(createUserSchema), controller.create);

/**
 * @openapi
 * /api/users:
 *   get:
 *     tags: [Users]
 *     summary: Get all users with optional filters [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [admin, employee, warehouse_manager, order_taker, delivery_man] }
 *         description: Filter by role
 *       - in: query
 *         name: isActive
 *         schema: { type: string, enum: ['true', 'false'] }
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden }
 */
router.get('/', requireRoles('admin', 'employee'), controller.findAll);

/**
 * @openapi
 * /api/users/role/{role}:
 *   get:
 *     tags: [Users]
 *     summary: Get all active users by role [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: role
 *         required: true
 *         schema:
 *           type: string
 *           enum: [admin, employee, warehouse_manager, order_taker, delivery_man]
 *     responses:
 *       200:
 *         description: List of users matching the given role
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 *       401: { description: Unauthorized }
 */
router.get('/role/:role', requireRoles('admin', 'employee'), controller.findByRole);

/**
 * @openapi
 * /api/users/me:
 *   get:
 *     tags: [Users]
 *     summary: Get the authenticated user (no password)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401: { description: Unauthorized }
 *       404: { description: User not found }
 */
router.get('/me', controller.getMe);

/**
 * @openapi
 * /api/users/me:
 *   patch:
 *     tags: [Users]
 *     summary: Update own profile (username, phone, email, address, profileImage only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               username: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               address: { $ref: '#/components/schemas/Address' }
 *               profileImage: { type: string }
 *     responses:
 *       200:
 *         description: Updated user
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       404: { description: User not found }
 *       409: { description: Username or phone conflict }
 */
router.patch('/me', validate(updateProfileSchema), controller.updateMe);

/**
 * @openapi
 * /api/users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Get a user by ID [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the user
 *     responses:
 *       200:
 *         description: Returns the user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401: { description: Unauthorized }
 *       404: { description: User not found }
 */
router.get('/:id', requireRoles('admin', 'employee'), controller.findOne);

/**
 * @openapi
 * /api/users/{id}:
 *   put:
 *     tags: [Users]
 *     summary: Update a user by ID [Admin]
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
 *               username: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               password: { type: string, minLength: 6 }
 *               role: { type: string, enum: [admin, employee, warehouse_manager, order_taker, delivery_man] }
 *               isActive: { type: boolean }
 *               address: { $ref: '#/components/schemas/Address' }
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — admin role required }
 *       404: { description: User not found }
 */
router.put('/:id', requireRoles('admin'), validate(updateUserSchema), controller.update);

/**
 * @openapi
 * /api/users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: Soft-delete a user by ID [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: User deleted (deactivated) successfully }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — admin role required }
 *       404: { description: User not found }
 */
router.delete('/:id', requireRoles('admin'), controller.remove);
router.patch('/:id/restore', requireRoles('admin'), controller.restore);
router.delete('/:id/permanent', requireRoles('admin'), controller.removePermanent);

export default router;

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createCategorySchema, updateCategorySchema } from './dto/categories.schemas';
import * as controller from './categories.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/categories:
 *   post:
 *     tags: [Categories]
 *     summary: Create a new category [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               image: { type: string }
 *     responses:
 *       201: { description: Category created }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/', requireRoles('admin'), validate(createCategorySchema), controller.create);

/**
 * @openapi
 * /api/categories:
 *   get:
 *     tags: [Categories]
 *     summary: Get all categories [All roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of categories }
 *       401: { description: Unauthorized }
 */
router.get('/', controller.findAll);

/**
 * @openapi
 * /api/categories/{id}:
 *   get:
 *     tags: [Categories]
 *     summary: Get a category by ID [All roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Category found }
 *       404: { description: Category not found }
 */
router.get('/:id', controller.findOne);

/**
 * @openapi
 * /api/categories/{id}:
 *   put:
 *     tags: [Categories]
 *     summary: Update a category [Admin]
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
 *               description: { type: string }
 *               image: { type: string }
 *     responses:
 *       200: { description: Category updated }
 *       404: { description: Category not found }
 */
router.put('/:id', requireRoles('admin'), validate(updateCategorySchema), controller.update);

/**
 * @openapi
 * /api/categories/{id}:
 *   delete:
 *     tags: [Categories]
 *     summary: Delete a category [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Category deleted }
 *       404: { description: Category not found }
 */
router.delete('/:id', requireRoles('admin'), controller.remove);
router.patch('/:id/restore', requireRoles('admin'), controller.restore);
router.delete('/:id/permanent', requireRoles('admin'), controller.removePermanent);

export default router;

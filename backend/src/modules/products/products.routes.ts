import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createProductSchema, updateProductSchema } from './dto/products.schemas';
import * as controller from './products.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/products:
 *   post:
 *     tags: [Products]
 *     summary: Create a new product [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [barcode, name, categoryId]
 *             properties:
 *               barcode: { type: string }
 *               name: { type: string }
 *               description: { type: string }
 *               image: { type: string }
 *               salePrice: { type: number }
 *               purchasePrice: { type: number }
 *               quantity: { type: number }
 *               categoryId: { type: string }
 *     responses:
 *       201: { description: Product created }
 *       400: { description: Validation error or duplicate barcode }
 *       401: { description: Unauthorized }
 */
router.post('/', requireRoles('admin'), validate(createProductSchema), controller.create);

/**
 * @openapi
 * /api/products:
 *   get:
 *     tags: [Products]
 *     summary: Get all products [All roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: categoryId
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by name or barcode
 *     responses:
 *       200: { description: List of products }
 *       401: { description: Unauthorized }
 */
router.get('/', controller.findAll);

/**
 * @openapi
 * /api/products/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Get a product by ID [All roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Product found }
 *       404: { description: Product not found }
 */
router.get('/:id', controller.findOne);

/**
 * @openapi
 * /api/products/{id}:
 *   put:
 *     tags: [Products]
 *     summary: Update a product [Admin]
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
 *               barcode: { type: string }
 *               name: { type: string }
 *               description: { type: string }
 *               image: { type: string }
 *               salePrice: { type: number }
 *               purchasePrice: { type: number }
 *               quantity: { type: number }
 *               categoryId: { type: string }
 *     responses:
 *       200: { description: Product updated }
 *       404: { description: Product not found }
 */
router.put('/:id', requireRoles('admin'), validate(updateProductSchema), controller.update);

/**
 * @openapi
 * /api/products/{id}:
 *   delete:
 *     tags: [Products]
 *     summary: Delete a product [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Product deleted }
 *       404: { description: Product not found }
 */
router.delete('/:id', requireRoles('admin'), controller.remove);

export default router;

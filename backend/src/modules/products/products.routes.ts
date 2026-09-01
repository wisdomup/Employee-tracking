import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission, requirePermission } from '../../middleware/permission.middleware';
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
 *               # `quantity` is derived from warehouse stock and is read-only here.
 *               categoryId: { type: string }
 *     responses:
 *       201: { description: Product created }
 *       400: { description: Validation error or duplicate barcode }
 *       401: { description: Unauthorized }
 */
router.post('/', requirePermission('products:add'), validate(createProductSchema), controller.create);

/**
 * @openapi
 * /api/products:
 *   get:
 *     tags: [Products]
 *     summary: Get all products, full catalogue records [products:view]
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
/**
 * Catalogue-grade data: stock thresholds, last purchase rate, and the populated `createdBy` user,
 * whose document carries the creator's salary, notes, home address and phone. Gated on
 * `products:view` — untick that cell for a role and the /products screen closes with it.
 */
router.get('/', requirePermission('products:view'), controller.findAll);

/**
 * @openapi
 * /api/products/picker:
 *   get:
 *     tags: [Products]
 *     summary: Product list for order/return line-item selectors [any role that can book one]
 *     description: >
 *       Returns only `_id`, `barcode`, `name`, `salePrice`, `quantity` and the category name.
 *       Purchase cost, last purchase rate, low-stock level and the creator record are omitted by
 *       projection, so a Salesman can select a product without `products:view`.
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
 *       200: { description: Reduced product list }
 *       401: { description: Unauthorized }
 *       403: { description: Cannot create or edit an order or return }
 */
// Selecting a product is part of booking a document, not a permission of its own — the five-action
// matrix has no cell for it, and adding a "Product Picker" module would put a checkbox on the
// admin screen that nobody can reason about. So the right to read this list follows from the right
// to write the document it feeds. A Salesman with orders:add keeps working with products:view off.
//
// MUST stay above `/:id`, or Express matches 'picker' as an id and returns 404.
router.get(
  '/picker',
  requireAnyPermission('orders:add', 'orders:edit', 'returns:add', 'returns:edit', 'products:view'),
  controller.findAllForPicker,
);

/**
 * @openapi
 * /api/products/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Get a product by ID [products:view]
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
router.get('/:id', requirePermission('products:view'), controller.findOne);

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
 *               # `quantity` is derived from warehouse stock and is read-only here.
 *               categoryId: { type: string }
 *     responses:
 *       200: { description: Product updated }
 *       404: { description: Product not found }
 */
router.put('/:id', requirePermission('products:edit'), validate(updateProductSchema), controller.update);

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
router.delete('/:id', requirePermission('products:delete'), controller.remove);
router.patch('/:id/restore', requirePermission('trash:change'), controller.restore);
router.delete('/:id/permanent', requirePermission('trash:delete'), controller.removePermanent);

export default router;

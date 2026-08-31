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
 *               # `quantity` is derived from warehouse stock and is read-only here.
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
 *     summary: Get all products, full catalogue records [Admin, Sales Manager, Warehouse]
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
 * Catalogue-grade data: stock thresholds, last purchase rate, and the populated `createdBy` user.
 * Roles that only need to pick a product in a line item use GET /api/products/picker instead.
 * This guard is the backend half of the frontend `products:view-catalog` permission; the warehouse
 * roles are here because their stock documents read `quantity` and `lastPurchaseRate`.
 */
export const CATALOG_ROLES = [
  'admin',
  'sales_manager',
  'warehouse_manager',
  'warehouse_staff',
] as const;

router.get('/', requireRoles(...CATALOG_ROLES), controller.findAll);

/**
 * @openapi
 * /api/products/picker:
 *   get:
 *     tags: [Products]
 *     summary: Product list for order/return line-item selectors [All roles]
 *     description: >
 *       Returns only `_id`, `barcode`, `name`, `salePrice`, `quantity` and the category name.
 *       Purchase cost, last purchase rate, low-stock level and the creator record are omitted by
 *       projection, so an order taker can select a product without reading catalogue data.
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
 */
// MUST stay above `/:id`, or Express matches 'picker' as an id and returns 404.
router.get('/picker', controller.findAllForPicker);

/**
 * @openapi
 * /api/products/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Get a product by ID [Admin, Sales Manager, Warehouse]
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
router.get('/:id', requireRoles(...CATALOG_ROLES), controller.findOne);

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
router.patch('/:id/restore', requireRoles('admin'), controller.restore);
router.delete('/:id/permanent', requireRoles('admin'), controller.removePermanent);

export default router;

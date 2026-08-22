import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { blockFrozenWrites } from '../../middleware/frozen.middleware';
import { validate } from '../../middleware/validate.middleware';
import { uploadReturnInvoiceSingle } from '../../middleware/upload.middleware';
import { createReturnSchema, updateReturnSchema } from './dto/returns.schemas';
import * as controller from './returns.controller';

const router = Router();

router.use(authMiddleware);
// A frozen rider may still read their day, but records no work until an admin unfreezes them.
router.use(blockFrozenWrites);

/**
 * @openapi
 * /api/returns:
 *   post:
 *     tags: [Returns]
 *     summary: Create a return or damage [Admin, Employee, Order Taker]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [dealerId, returnType, products]
 *             properties:
 *               dealerId: { type: string }
 *               returnType: { type: string, enum: [return, damage] }
 *               products: { type: string, description: "JSON array of {productId, quantity, price}" }
 *               invoiceImage: { type: string, format: binary }
 *               amount: { type: number }
 *               returnReason: { type: string }
 *     responses:
 *       201: { description: Return created }
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post(
  '/',
  requirePermission('returns:add'),
  (req, res, next) => {
    uploadReturnInvoiceSingle(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ message: err instanceof Error ? err.message : 'Invoice image upload failed' });
        return;
      }
      next();
    });
  },
  validate(createReturnSchema),
  controller.create,
);

/**
 * @openapi
 * /api/returns:
 *   get:
 *     tags: [Returns]
 *     summary: Get all returns [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dealerId
 *         schema: { type: string }
 *       - in: query
 *         name: returnType
 *         schema: { type: string, enum: [return, damage] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, picked, completed] }
 *       - in: query
 *         name: createdBy
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of returns }
 *       401: { description: Unauthorized }
 */
router.get('/', requirePermission('returns:view'), controller.findAll);

/**
 * @openapi
 * /api/returns/{id}:
 *   get:
 *     tags: [Returns]
 *     summary: Get a return by ID [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Return found }
 *       404: { description: Return not found }
 */
router.get('/:id', requirePermission('returns:view'), controller.findOne);

/**
 * @openapi
 * /api/returns/{id}:
 *   put:
 *     tags: [Returns]
 *     summary: Update a return [Admin] (non-completed only; completed returns are locked)
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               returnType: { type: string, enum: [return, damage] }
 *               products: { type: string, description: "JSON array of {productId, quantity, price}" }
 *               invoiceImage: { type: string, format: binary }
 *               amount: { type: number }
 *               returnReason: { type: string }
 *               status: { type: string, enum: [pending, approved, picked, completed] }
 *     responses:
 *       200: { description: Return updated }
 *       400: { description: Completed returns are locked and cannot be edited }
 *       404: { description: Return not found }
 */
router.put(
  '/:id',
  requirePermission('returns:edit'),
  (req, res, next) => {
    uploadReturnInvoiceSingle(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ message: err instanceof Error ? err.message : 'Invoice image upload failed' });
        return;
      }
      next();
    });
  },
  validate(updateReturnSchema),
  controller.update,
);

/**
 * @openapi
 * /api/returns/{id}:
 *   delete:
 *     tags: [Returns]
 *     summary: Delete a return [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Return deleted }
 *       404: { description: Return not found }
 */
router.delete('/:id', requirePermission('returns:delete'), controller.remove);
router.patch('/:id/restore', requirePermission('trash:change'), controller.restore);
router.delete('/:id/permanent', requirePermission('trash:delete'), controller.removePermanent);

export default router;

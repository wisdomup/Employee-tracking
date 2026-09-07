import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createVendorSchema,
  updateVendorSchema,
  setVendorStatusSchema,
  assignSupplierNamesSchema,
} from './dto/vendors.schemas';
import * as vendors from './vendors.controller';

/**
 * Suppliers, and the one-off reconciliation of the free-text names already on goods receipts.
 *
 * The clean-up routes sit under `/vendors/migration` and are gated on `change` rather than
 * `edit`: assigning typed names rewrites which supplier a body of historical receipts belongs
 * to, which is a heavier act than correcting a phone number.
 */
const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/finance/vendors:
 *   get:
 *     tags: [Finance — Suppliers]
 *     summary: List suppliers, with what has been received from each
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: search, schema: { type: string }, description: "Name, a name it was merged from, or phone" }
 *       - { in: query, name: status, schema: { type: string, enum: [active, inactive, all] } }
 *     responses:
 *       200: { description: Suppliers }
 */
router.get('/vendors', requirePermission('finance-vendors:view'), vendors.list);

/**
 * @openapi
 * /api/finance/vendors/migration/candidates:
 *   get:
 *     tags: [Finance — Suppliers]
 *     summary: Every distinct supplier name typed on a goods receipt
 *     description: >
 *       The input to the one-off clean-up. Ordered by value, because that is the order in which
 *       getting a merge wrong costs the most. Each name carries what it is worth, whether it
 *       already resolves to a supplier, and any existing suppliers whose name looks like it.
 *       The suggestions are deliberately conservative — a confident wrong merge silently
 *       attributes one supplier's goods to another.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ candidates, unnamedReceipts }" }
 */
router.get(
  '/vendors/migration/candidates',
  requirePermission('finance-vendors:view'),
  vendors.candidates,
);

/**
 * @openapi
 * /api/finance/vendors/migration/progress:
 *   get:
 *     tags: [Finance — Suppliers]
 *     summary: How far through the clean-up we are
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Counts of linked and unlinked receipts }
 */
router.get(
  '/vendors/migration/progress',
  requirePermission('finance-vendors:view'),
  vendors.progress,
);

/**
 * @openapi
 * /api/finance/vendors/migration/assign:
 *   post:
 *     tags: [Finance — Suppliers]
 *     summary: Attach typed names to one supplier, creating it if needed
 *     description: >
 *       Back-links every matching goods receipt and records on the supplier which names were
 *       combined, so a merge stays visible. The receipts keep the name that was actually typed.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [typedNames]
 *             properties:
 *               vendorId: { type: string, description: "An existing supplier" }
 *               newVendorName: { type: string, description: "Or a new one. Not both." }
 *               typedNames: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: "{ vendor, receiptsLinked }" }
 *       400: { description: Both or neither of supplier and new name given }
 *       409: { description: That supplier name already exists }
 */
router.post(
  '/vendors/migration/assign',
  requirePermission('finance-vendors:change'),
  validate(assignSupplierNamesSchema),
  vendors.assignNames,
);

/**
 * @openapi
 * /api/finance/vendors/migration/park-unassigned:
 *   post:
 *     tags: [Finance — Suppliers]
 *     summary: Park every still-unlinked receipt on a named placeholder
 *     description: >
 *       Leaving them unlinked makes the goods-received total unprovable by supplier, which is
 *       worse than a bucket somebody can work through later. The placeholder is deliberately
 *       obvious rather than quietly plausible, and is meant to empty over time.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ vendor, receiptsLinked }" }
 */
router.post(
  '/vendors/migration/park-unassigned',
  requirePermission('finance-vendors:change'),
  vendors.parkUnassigned,
);

/**
 * @openapi
 * /api/finance/vendors/{id}:
 *   get:
 *     tags: [Finance — Suppliers]
 *     summary: One supplier
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Supplier }
 *       404: { description: Not found }
 */
router.get('/vendors/:id', requirePermission('finance-vendors:view'), vendors.getOne);

/**
 * @openapi
 * /api/finance/vendors:
 *   post:
 *     tags: [Finance — Suppliers]
 *     summary: Create a supplier
 *     description: >
 *       Names are unique regardless of casing. The whole problem this list solves is one supplier
 *       existing under several spellings, so allowing "Acme" and "acme" would recreate it.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 *       409: { description: That name already exists }
 */
router.post(
  '/vendors',
  requirePermission('finance-vendors:add'),
  validate(createVendorSchema),
  vendors.create,
);

/**
 * @openapi
 * /api/finance/vendors/{id}:
 *   patch:
 *     tags: [Finance — Suppliers]
 *     summary: Edit a supplier
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       409: { description: That name already exists }
 */
router.patch(
  '/vendors/:id',
  requirePermission('finance-vendors:edit'),
  validate(updateVendorSchema),
  vendors.update,
);

/**
 * @openapi
 * /api/finance/vendors/{id}/status:
 *   patch:
 *     tags: [Finance — Suppliers]
 *     summary: Activate or deactivate a supplier
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Status changed }
 */
router.patch(
  '/vendors/:id/status',
  requirePermission('finance-vendors:change'),
  validate(setVendorStatusSchema),
  vendors.setStatus,
);

/**
 * @openapi
 * /api/finance/vendors/{id}:
 *   delete:
 *     tags: [Finance — Suppliers]
 *     summary: Delete a supplier nothing has been received from
 *     description: >
 *       Refused once any goods receipt names it — deleting would leave those receipts pointing at
 *       nothing. Deactivate instead. The placeholder record cannot be deleted at all.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 *       409: { description: Goods receipts name this supplier }
 */
router.delete('/vendors/:id', requirePermission('finance-vendors:delete'), vendors.remove);

export default router;

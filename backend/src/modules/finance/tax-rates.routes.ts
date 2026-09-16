import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createTaxRateSchema,
  updateTaxRateSchema,
  setTaxRateStatusSchema,
} from './dto/tax-rates.schemas';
import * as rates from './tax-rates.controller';

/**
 * The tax rates the business is registered for.
 *
 * Reading them is open to anyone who can record a payment, because the payment form offers them;
 * deciding what they are is not. `change` is retiring a rate — a rate that stops being offered
 * without anything already recorded against it changing.
 */
const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/finance/tax-rates:
 *   get:
 *     tags: [Finance — Tax Rates]
 *     summary: List tax rates
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: kind, schema: { type: string, enum: [sales, withholding] } }
 *       - { in: query, name: status, schema: { type: string, enum: [active, inactive, all] } }
 *     responses:
 *       200: { description: Tax rates, with how many posted documents cite each }
 */
router.get('/tax-rates', requirePermission('finance-tax-rates:view'), rates.list);

/**
 * @openapi
 * /api/finance/tax-rates:
 *   post:
 *     tags: [Finance — Tax Rates]
 *     summary: Add a tax rate
 *     description: >
 *       The kind is fixed at creation and can never change. Tax charged on a sale and tax
 *       withheld from a supplier behave in opposite ways, and a rate that switched between them
 *       would misdescribe every document that had already cited it.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: The new rate }
 *       409: { description: A rate of that kind already has that name }
 */
router.post(
  '/tax-rates',
  requirePermission('finance-tax-rates:add'),
  validate(createTaxRateSchema),
  rates.create,
);

/**
 * @openapi
 * /api/finance/tax-rates/{id}:
 *   put:
 *     tags: [Finance — Tax Rates]
 *     summary: Correct a tax rate
 *     description: >
 *       Editing the percentage changes what future documents are filled in with and nothing
 *       else. Anything already posted keeps the figure it was posted with — a budget changing a
 *       rate must not restate a payment made under the old one.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The updated rate }
 *       400: { description: An attempt to change the kind }
 */
router.put(
  '/tax-rates/:id',
  requirePermission('finance-tax-rates:edit'),
  validate(updateTaxRateSchema),
  rates.update,
);

/**
 * @openapi
 * /api/finance/tax-rates/{id}/status:
 *   patch:
 *     tags: [Finance — Tax Rates]
 *     summary: Retire a rate, or bring it back
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The updated rate }
 */
router.patch(
  '/tax-rates/:id/status',
  requirePermission('finance-tax-rates:change'),
  validate(setTaxRateStatusSchema),
  rates.setStatus,
);

/**
 * @openapi
 * /api/finance/tax-rates/{id}:
 *   delete:
 *     tags: [Finance — Tax Rates]
 *     summary: Delete a rate nothing has used
 *     description: >
 *       Refused once a posted payment cites it — deleting would leave that payment saying a
 *       deduction was made at a rate that no longer exists. Retire it instead.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 *       400: { description: Posted payments cite this rate }
 */
router.delete('/tax-rates/:id', requirePermission('finance-tax-rates:delete'), rates.remove);

export default router;

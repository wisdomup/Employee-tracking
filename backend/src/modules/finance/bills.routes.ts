import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createBillSchema, updateBillSchema, cancelBillSchema } from './dto/bills.schemas';
import * as bills from './bills.controller';

/**
 * Supplier bills.
 *
 * Two guards worth noticing.
 *
 * Posting a bill is `change` on this row, not `add` — writing an invoice down and committing it
 * to the accounts are different powers, and an accounts clerk who enters the day's post should
 * not necessarily be the person who commits it.
 *
 * Cancelling is guarded on the REVERSALS row instead of this one, because that is what it does:
 * it reverses a posted entry. Whoever records the work should not also be able to undo it, which
 * is the whole reason reversal is a matrix row of its own.
 */
const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/finance/bills:
 *   get:
 *     tags: [Finance — Bills]
 *     summary: List supplier bills
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: vendorId, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [draft, posted, cancelled, all] } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: overdue, schema: { type: boolean }, description: "Posted bills past their due date" }
 *       - { in: query, name: search, schema: { type: string }, description: "The supplier's own invoice number" }
 *     responses:
 *       200: { description: Bills }
 */
router.get('/bills', requirePermission('finance-bills:view'), bills.list);

/**
 * @openapi
 * /api/finance/bills/open-receipts/{vendorId}:
 *   get:
 *     tags: [Finance — Bills]
 *     summary: Goods receipts from this supplier that are not yet fully billed
 *     description: >
 *       The input to the bill form. Only receipts that actually reached the accounts appear —
 *       one recorded while stock-receipt posting was switched off put nothing into Goods
 *       Received Not Invoiced, so there would be nothing on it for a bill to clear. Each row
 *       carries what the receipt was worth, what has already been billed against it, and what
 *       is left.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: vendorId, required: true, schema: { type: string } }
 *       - { in: query, name: billId, schema: { type: string }, description: "The draft being edited, so its own receipts stay listed" }
 *     responses:
 *       200: { description: Open goods receipts }
 */
router.get(
  '/bills/open-receipts/:vendorId',
  requirePermission('finance-bills:view'),
  bills.openReceipts,
);

/**
 * @openapi
 * /api/finance/bills/{id}:
 *   get:
 *     tags: [Finance — Bills]
 *     summary: One bill, with its matched receipts and charge lines
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Bill }
 *       404: { description: Not found }
 */
router.get('/bills/:id', requirePermission('finance-bills:view'), bills.getOne);

/**
 * @openapi
 * /api/finance/bills:
 *   post:
 *     tags: [Finance — Bills]
 *     summary: Record a supplier bill as a draft
 *     description: >
 *       Writes nothing to the accounts. A draft carries no bill number either — the series is
 *       allocated at post, so an abandoned draft leaves no gap for an auditor to ask about.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Draft bill }
 *       400: { description: A receipt is unattached, already billed, or over-claimed }
 *       409: { description: This invoice number is already recorded against this supplier }
 */
router.post(
  '/bills',
  requirePermission('finance-bills:add'),
  validate(createBillSchema),
  bills.create,
);

/**
 * @openapi
 * /api/finance/bills/{id}:
 *   put:
 *     tags: [Finance — Bills]
 *     summary: Correct a draft bill
 *     description: >
 *       Drafts only. A posted bill is cancelled and re-entered rather than edited, so the
 *       original and the correction both stay on the record.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated draft }
 *       400: { description: The bill is posted or cancelled }
 */
router.put(
  '/bills/:id',
  requirePermission('finance-bills:edit'),
  validate(updateBillSchema),
  bills.update,
);

/**
 * @openapi
 * /api/finance/bills/{id}:
 *   delete:
 *     tags: [Finance — Bills]
 *     summary: Delete a draft bill
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 *       400: { description: The bill is posted — cancel it instead }
 */
router.delete('/bills/:id', requirePermission('finance-bills:delete'), bills.remove);

/**
 * @openapi
 * /api/finance/bills/{id}/post:
 *   patch:
 *     tags: [Finance — Bills]
 *     summary: Commit a bill to the accounts
 *     description: >
 *       Debits Goods Received Not Invoiced by the matched goods, debits each charge account and
 *       input tax, and credits Accounts Payable for the whole invoice against this supplier.
 *       Everything is re-checked at this moment rather than trusted from when the draft was
 *       typed. Safe to call twice — the second call finds the entry already written.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Posted bill }
 *       400: { description: A receipt was cancelled, re-billed elsewhere, or never posted }
 */
router.patch('/bills/:id/post', requirePermission('finance-bills:change'), bills.post);

/**
 * @openapi
 * /api/finance/bills/{id}/cancel:
 *   patch:
 *     tags: [Finance — Bills]
 *     summary: Cancel a posted bill and reverse its entry
 *     description: >
 *       Guarded on the reversals row rather than on bills, because reversing a posted entry is
 *       what it does. The goods receipts it was holding become billable again on their own —
 *       what has been billed is derived from posted bills, so this one leaving that set releases
 *       them with no second write.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Cancelled bill }
 *       400: { description: The bill was never posted }
 *       409: { description: Already cancelled }
 */
router.patch(
  '/bills/:id/cancel',
  requirePermission('finance-reversal:change'),
  validate(cancelBillSchema),
  bills.cancel,
);

export default router;

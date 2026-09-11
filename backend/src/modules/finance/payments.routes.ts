import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createPaymentSchema,
  updatePaymentSchema,
  cancelPaymentSchema,
  clearChequeSchema,
} from './dto/payments.schemas';
import * as payments from './payments.controller';

/**
 * Supplier payments.
 *
 * Posting is `change` on the payments row — releasing money — and the seed deliberately gives it
 * to a different role from the one that records bills. Cancelling a posted payment is guarded on
 * the reversals row, with every other undo.
 */
const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/finance/payments:
 *   get:
 *     tags: [Finance — Payments]
 *     summary: List payments made to suppliers
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: vendorId, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [draft, posted, cancelled, all] } }
 *       - { in: query, name: method, schema: { type: string, enum: [cash, bank_transfer, cheque] } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: search, schema: { type: string }, description: "Cheque number or transfer reference" }
 *       - { in: query, name: unclearedCheques, schema: { type: boolean }, description: "Released cheques not yet on the bank statement" }
 *     responses:
 *       200: { description: Payments }
 */
router.get('/payments', requirePermission('finance-payments:view'), payments.list);

/**
 * @openapi
 * /api/finance/payments/open-bills/{vendorId}:
 *   get:
 *     tags: [Finance — Payments]
 *     summary: A supplier's posted bills that still have something unpaid
 *     description: >
 *       The input to the payment form, oldest due date first. Each row carries the bill total,
 *       what has already been paid against it, and what is left.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: vendorId, required: true, schema: { type: string } }
 *       - { in: query, name: paymentId, schema: { type: string }, description: "The draft being edited, so its own bills stay listed" }
 *     responses:
 *       200: { description: Unpaid bills }
 */
router.get(
  '/payments/open-bills/:vendorId',
  requirePermission('finance-payments:view'),
  payments.openBills,
);

/**
 * @openapi
 * /api/finance/payments/{id}:
 *   get:
 *     tags: [Finance — Payments]
 *     summary: One payment, with the bills it settled
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Payment }
 *       404: { description: Not found }
 */
router.get('/payments/:id', requirePermission('finance-payments:view'), payments.getOne);

/**
 * @openapi
 * /api/finance/payments:
 *   post:
 *     tags: [Finance — Payments]
 *     summary: Prepare a supplier payment as a draft
 *     description: >
 *       Moves no money in the books and uses no payment number. Allocations may add up to less
 *       than the payment — the remainder is held on account against the supplier.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Draft payment }
 *       400: { description: A bill is from another supplier, already paid, or over-settled }
 *       409: { description: This cheque number is already recorded from this account }
 */
router.post(
  '/payments',
  requirePermission('finance-payments:add'),
  validate(createPaymentSchema),
  payments.create,
);

/**
 * @openapi
 * /api/finance/payments/{id}:
 *   put:
 *     tags: [Finance — Payments]
 *     summary: Correct a draft payment
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated draft }
 *       400: { description: The payment is posted or cancelled }
 */
router.put(
  '/payments/:id',
  requirePermission('finance-payments:edit'),
  validate(updatePaymentSchema),
  payments.update,
);

/**
 * @openapi
 * /api/finance/payments/{id}:
 *   delete:
 *     tags: [Finance — Payments]
 *     summary: Delete a draft payment
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 *       400: { description: The payment is posted — cancel it instead }
 */
router.delete('/payments/:id', requirePermission('finance-payments:delete'), payments.remove);

/**
 * @openapi
 * /api/finance/payments/{id}/post:
 *   patch:
 *     tags: [Finance — Payments]
 *     summary: Release a payment — post it to the accounts
 *     description: >
 *       Debits Accounts Payable against the supplier and credits the cash or bank account, or
 *       Cheques Issued for a cheque until it clears. Re-checked at this moment, under a lock on
 *       every bill it settles, so two payments cannot both settle the same invoice.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Posted payment }
 *       400: { description: A bill was cancelled or already paid since the draft was saved }
 *       409: { description: Somebody else is posting against the same bill right now }
 */
router.patch('/payments/:id/post', requirePermission('finance-payments:change'), payments.post);

/**
 * @openapi
 * /api/finance/payments/{id}/clear-cheque:
 *   patch:
 *     tags: [Finance — Payments]
 *     summary: Record that a cheque has cleared on the bank statement
 *     description: >
 *       Moves the amount out of Cheques Issued, Uncleared and into the bank account the cheque
 *       was drawn on, dated the day it cleared. What the supplier is owed does not change — that
 *       fell when the payment was released.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Payment, with the clearing date }
 *       400: { description: Not a released cheque, or dated before it was written }
 *       409: { description: Already cleared }
 */
router.patch(
  '/payments/:id/clear-cheque',
  requirePermission('finance-payments:change'),
  validate(clearChequeSchema),
  payments.clearCheque,
);

/**
 * @openapi
 * /api/finance/payments/{id}/cancel:
 *   patch:
 *     tags: [Finance — Payments]
 *     summary: Cancel a posted payment and reverse its entry
 *     description: >
 *       Guarded on the reversals row. The bills it settled become unpaid again on their own —
 *       what has been paid is derived from posted payments. A cheque that has already cleared
 *       cannot be cancelled: the money has left the bank.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Cancelled payment }
 *       400: { description: The payment was never posted, or its cheque has cleared }
 *       409: { description: Already cancelled }
 */
router.patch(
  '/payments/:id/cancel',
  requirePermission('finance-reversal:change'),
  validate(cancelPaymentSchema),
  payments.cancel,
);

export default router;

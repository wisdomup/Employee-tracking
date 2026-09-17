import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createVoucherSchema,
  updateVoucherSchema,
  rejectVoucherSchema,
  cancelVoucherSchema,
} from './dto/vouchers.schemas';
import * as vouchers from './vouchers.controller';

/**
 * The six manual vouchers: CPV, CRV, BPV, BRV, CV and JV.
 *
 * Raising and submitting are `add` — one act by the person who has the paperwork in front of them.
 * Approving, sending back and posting are `change`, held by somebody else. Cancelling a posted
 * voucher is on the reversals row, with every other undo.
 */
const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/finance/vouchers:
 *   get:
 *     tags: [Finance — Vouchers]
 *     summary: List vouchers
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: category, schema: { type: string, enum: [CPV, CRV, BPV, BRV, CV, JV] } }
 *       - { in: query, name: status, schema: { type: string, enum: [draft, submitted, approved, rejected, posted, cancelled, all] } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: partyId, schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string }, description: "Narration, reference or shop" }
 *     responses:
 *       200: { description: Vouchers }
 */
router.get('/vouchers', requirePermission('finance-vouchers:view'), vouchers.list);

/**
 * @openapi
 * /api/finance/vouchers/shops:
 *   get:
 *     tags: [Finance — Vouchers]
 *     summary: The shops a voucher can be raised against
 *     description: >
 *       A picker-sized list, behind the voucher permission. Finance does not hold the Clients
 *       permission, and a receipt taken at the counter still needs the shop named on it.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200: { description: Shops }
 */
router.get('/vouchers/shops', requirePermission('finance-vouchers:view'), vouchers.shops);

/**
 * @openapi
 * /api/finance/vouchers/{id}:
 *   get:
 *     tags: [Finance — Vouchers]
 *     summary: One voucher, with the exact entry it will write
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Voucher }
 *       404: { description: Not found }
 */
router.get('/vouchers/:id', requirePermission('finance-vouchers:view'), vouchers.getOne);

/**
 * @openapi
 * /api/finance/vouchers:
 *   post:
 *     tags: [Finance — Vouchers]
 *     summary: Raise a voucher
 *     description: >
 *       Posts nothing. The debits and credits are composed and checked as it is saved, so an
 *       approver sees the entry itself. Accounts another module keeps — supplier payables, stock,
 *       rider cash, staff advances, wages owed — are refused by name, with the screen that owns
 *       them. Spending against an expense account belongs on the Expenses screen, which carries
 *       the approval limits.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Draft voucher }
 *       400: { description: An account belongs to another module, or the two sides do not agree }
 */
router.post(
  '/vouchers',
  requirePermission('finance-vouchers:add'),
  validate(createVoucherSchema),
  vouchers.create,
);

/**
 * @openapi
 * /api/finance/vouchers/{id}:
 *   put:
 *     tags: [Finance — Vouchers]
 *     summary: Correct a voucher that is a draft or has been sent back
 *     description: A corrected voucher returns to draft, keeping the reason it came back.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Voucher }
 *       400: { description: It is waiting for approval, posted, or cancelled }
 */
router.put(
  '/vouchers/:id',
  requirePermission('finance-vouchers:edit'),
  validate(updateVoucherSchema),
  vouchers.update,
);

/**
 * @openapi
 * /api/finance/vouchers/{id}:
 *   delete:
 *     tags: [Finance — Vouchers]
 *     summary: Delete a voucher that has never posted
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 */
router.delete('/vouchers/:id', requirePermission('finance-vouchers:delete'), vouchers.remove);

/**
 * @openapi
 * /api/finance/vouchers/{id}/submit:
 *   patch:
 *     tags: [Finance — Vouchers]
 *     summary: Send a voucher for approval
 *     description: Re-checked on the way out, in case an account changed while it sat in drafts.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Submitted voucher }
 */
router.patch('/vouchers/:id/submit', requirePermission('finance-vouchers:add'), vouchers.submit);

/**
 * @openapi
 * /api/finance/vouchers/{id}/approve:
 *   patch:
 *     tags: [Finance — Vouchers]
 *     summary: Approve a submitted voucher
 *     description: >
 *       Refused to whoever raised it. Approving does not post: posting is the act that writes it to
 *       the accounts, and can wait for the month to be open.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Approved voucher }
 *       400: { description: Not waiting for approval, or the approver raised it }
 */
router.patch('/vouchers/:id/approve', requirePermission('finance-vouchers:change'), vouchers.approve);

/**
 * @openapi
 * /api/finance/vouchers/{id}/reject:
 *   patch:
 *     tags: [Finance — Vouchers]
 *     summary: Send a voucher back, with the reason
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Voucher sent back }
 */
router.patch(
  '/vouchers/:id/reject',
  requirePermission('finance-vouchers:change'),
  validate(rejectVoucherSchema),
  vouchers.reject,
);

/**
 * @openapi
 * /api/finance/vouchers/{id}/post:
 *   patch:
 *     tags: [Finance — Vouchers]
 *     summary: Post an approved voucher to the accounts
 *     description: >
 *       Writes exactly the lines on the document. Everything is re-checked first, and a month that
 *       is closed refuses it. Safe to call twice — the second call finds the entry already written.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Posted voucher }
 *       400: { description: Not approved yet, or the month is closed }
 */
router.patch('/vouchers/:id/post', requirePermission('finance-vouchers:change'), vouchers.post);

/**
 * @openapi
 * /api/finance/vouchers/{id}/cancel:
 *   patch:
 *     tags: [Finance — Vouchers]
 *     summary: Cancel a posted voucher and reverse its entry
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Cancelled voucher }
 *       400: { description: It was never posted }
 */
router.patch(
  '/vouchers/:id/cancel',
  requirePermission('finance-reversal:change'),
  validate(cancelVoucherSchema),
  vouchers.cancel,
);

export default router;

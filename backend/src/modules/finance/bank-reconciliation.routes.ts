import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createReconciliationSchema,
  updateReconciliationSchema,
  setClearedLinesSchema,
  reopenReconciliationSchema,
} from './dto/bank-reconciliation.schemas';
import * as bankRec from './bank-reconciliation.controller';

/**
 * Bank reconciliation.
 *
 * Signing one off is `change` rather than `edit`, because ticking lines and declaring that the
 * bank agreed are different acts — the second is a statement of fact somebody else will rely on.
 *
 * Reopening a signed-off reconciliation is guarded on the REVERSALS row, with every other undo.
 * Whoever signs the work off should not also be able to quietly take it back.
 */
const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/finance/bank-reconciliation/accounts:
 *   get:
 *     tags: [Finance — Bank Reconciliation]
 *     summary: The cash and bank accounts worth reconciling, and how far each has got
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Accounts with their last signed-off statement date and any open draft }
 */
router.get(
  '/bank-reconciliation/accounts',
  requirePermission('finance-bank-rec:view'),
  bankRec.accounts,
);

/**
 * @openapi
 * /api/finance/bank-reconciliation:
 *   get:
 *     tags: [Finance — Bank Reconciliation]
 *     summary: List reconciliations
 *     description: >
 *       A signed-off row reports the figures frozen at the moment it was completed, not figures
 *       recomputed now — a reconciliation whose numbers move when somebody back-dates an entry
 *       into the period is not evidence of anything.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: ledgerId, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [draft, completed, all] } }
 *     responses:
 *       200: { description: Reconciliations }
 */
router.get('/bank-reconciliation', requirePermission('finance-bank-rec:view'), bankRec.list);

/**
 * @openapi
 * /api/finance/bank-reconciliation/{id}:
 *   get:
 *     tags: [Finance — Bank Reconciliation]
 *     summary: One reconciliation, with the worksheet of lines to tick off
 *     description: >
 *       Carries every posted line on the account dated up to the statement date that an earlier
 *       statement has not already accounted for, plus the arithmetic: what the books say, what
 *       is still in flight, what the bank should therefore be showing, and the difference.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Reconciliation worksheet }
 *       404: { description: Not found }
 */
router.get('/bank-reconciliation/:id', requirePermission('finance-bank-rec:view'), bankRec.getOne);

/**
 * @openapi
 * /api/finance/bank-reconciliation:
 *   post:
 *     tags: [Finance — Bank Reconciliation]
 *     summary: Start a reconciliation from a bank statement
 *     description: >
 *       Writes nothing to the accounts, now or ever. The closing balance is signed, so an
 *       overdrawn account is entered as the statement prints it.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Draft reconciliation with its worksheet }
 *       400: { description: Not a cash account, or it sits behind one already signed off }
 *       409: { description: A reconciliation for that account and date already exists }
 */
router.post(
  '/bank-reconciliation',
  requirePermission('finance-bank-rec:add'),
  validate(createReconciliationSchema),
  bankRec.create,
);

/**
 * @openapi
 * /api/finance/bank-reconciliation/{id}:
 *   put:
 *     tags: [Finance — Bank Reconciliation]
 *     summary: Correct the statement balance or the note on a draft
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated draft }
 *       400: { description: Already signed off }
 */
router.put(
  '/bank-reconciliation/:id',
  requirePermission('finance-bank-rec:edit'),
  validate(updateReconciliationSchema),
  bankRec.update,
);

/**
 * @openapi
 * /api/finance/bank-reconciliation/{id}/lines:
 *   patch:
 *     tags: [Finance — Bank Reconciliation]
 *     summary: Tick lines off against the statement, or untick them
 *     description: >
 *       Takes a batch, so ticking a whole statement page is one request. A line already
 *       accounted for by an earlier signed-off statement is refused rather than counted twice.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated worksheet }
 *       400: { description: A line is not on this account, or is dated after the statement }
 *       409: { description: An earlier statement already claimed one of those lines }
 */
router.patch(
  '/bank-reconciliation/:id/lines',
  requirePermission('finance-bank-rec:edit'),
  validate(setClearedLinesSchema),
  bankRec.setCleared,
);

/**
 * @openapi
 * /api/finance/bank-reconciliation/{id}/complete:
 *   patch:
 *     tags: [Finance — Bank Reconciliation]
 *     summary: Sign the reconciliation off
 *     description: >
 *       Refused unless the difference is nil, which is the entire point of the screen — a
 *       reconciliation completed with a gap still open records that the bank agreed when it did
 *       not. Taken under a lock on the account, so two statements cannot both claim one deposit.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Signed-off reconciliation }
 *       400: { description: It does not balance yet }
 *       409: { description: Another statement claimed one of these lines }
 */
router.patch(
  '/bank-reconciliation/:id/complete',
  requirePermission('finance-bank-rec:change'),
  bankRec.complete,
);

/**
 * @openapi
 * /api/finance/bank-reconciliation/{id}/reopen:
 *   patch:
 *     tags: [Finance — Bank Reconciliation]
 *     summary: Reopen a signed-off reconciliation
 *     description: >
 *       Needs a reason, and is refused when a later statement was signed off on top of it —
 *       that one was worked out from what this one left outstanding.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Reopened draft }
 *       400: { description: Not signed off, or a later statement sits on top of it }
 */
router.patch(
  '/bank-reconciliation/:id/reopen',
  requirePermission('finance-reversal:change'),
  validate(reopenReconciliationSchema),
  bankRec.reopen,
);

/**
 * @openapi
 * /api/finance/bank-reconciliation/{id}:
 *   delete:
 *     tags: [Finance — Bank Reconciliation]
 *     summary: Discard a draft reconciliation
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Discarded }
 *       400: { description: Already signed off }
 */
router.delete(
  '/bank-reconciliation/:id',
  requirePermission('finance-bank-rec:delete'),
  bankRec.remove,
);

export default router;

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  saveWorksheetSchema,
  postOpeningEntrySchema,
  closeOpeningEquitySchema,
  reopenMigrationSchema,
} from './dto/opening-balances.schemas';
import * as opening from './opening-balances.controller';

/**
 * The changeover: what the business owned and owed on the day the books went live.
 *
 * Every write here is gated on its own matrix row, and the seed grants that row to the Finance
 * Manager alone. This is done once in the life of the business, it decides every figure the
 * accounts start from, and it is not part of anybody's daily work.
 *
 * Reopening it is an undo, so it rides on the reversals row with the rest.
 */
const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/finance/opening-balances/status:
 *   get:
 *     tags: [Finance — Opening Balances]
 *     summary: How far the changeover has got
 *     description: >
 *       Reports the stage, the changeover date, and the balance left on Opening Balance Equity.
 *       While that balance is not nil the changeover is unfinished — either the figures are
 *       incomplete or nobody has decided whose money it is.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Migration status }
 */
router.get(
  '/opening-balances/status',
  requirePermission('finance-opening:view'),
  opening.status,
);

/**
 * @openapi
 * /api/finance/opening-balances/worksheet:
 *   get:
 *     tags: [Finance — Opening Balances]
 *     summary: Every account, with the opening figure staged against it
 *     description: >
 *       Control accounts are read-only and say why: receivables, stock and rider cash are built
 *       by the modules that own them out of records the business already keeps, and a figure
 *       typed on top would be counted twice. Payables are the exception — that total is built
 *       from each supplier's own opening figure so it can be broken down by supplier.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Worksheet with running totals and the balancing figure }
 */
router.get(
  '/opening-balances/worksheet',
  requirePermission('finance-opening:view'),
  opening.worksheet,
);

/**
 * @openapi
 * /api/finance/opening-balances/worksheet:
 *   put:
 *     tags: [Finance — Opening Balances]
 *     summary: Stage opening figures
 *     description: >
 *       Writes nothing to the accounts. Amounts are given in each account's own direction —
 *       positive against Bank is money held, positive against a loan is money owed.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated worksheet }
 *       400: { description: A control account, or the balancing account, was typed into }
 */
router.put(
  '/opening-balances/worksheet',
  requirePermission('finance-opening:edit'),
  validate(saveWorksheetSchema),
  opening.save,
);

/**
 * @openapi
 * /api/finance/opening-balances/post:
 *   post:
 *     tags: [Finance — Opening Balances]
 *     summary: Open the books
 *     description: >
 *       Turns the worksheet into one dated entry, clears the staged figures so no report counts
 *       them twice, and records the changeover date. Refused when anything is already posted on
 *       or before that date — an opening balance and the transactions behind it describe the
 *       same money.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The opening entry and the new status }
 *       400: { description: Postings already exist before the changeover date, or every figure is zero }
 *       409: { description: The books are already open }
 */
router.post(
  '/opening-balances/post',
  requirePermission('finance-opening:change'),
  validate(postOpeningEntrySchema),
  opening.post,
);

/**
 * @openapi
 * /api/finance/opening-balances/close-equity:
 *   post:
 *     tags: [Finance — Opening Balances]
 *     summary: Carry Opening Balance Equity to the owner's capital, finishing the changeover
 *     description: >
 *       A separate act from opening the books, because it is a different decision: the first
 *       says what the business had, this one says whose it is. Only an equity account can
 *       receive it. Once done, Opening Balance Equity reads nil — which is the proof.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Migration status, now complete }
 *       400: { description: Not an equity account, or the balances were never posted }
 *       409: { description: Already nil }
 */
router.post(
  '/opening-balances/close-equity',
  requirePermission('finance-opening:change'),
  validate(closeOpeningEquitySchema),
  opening.closeEquity,
);

/**
 * @openapi
 * /api/finance/opening-balances/reopen:
 *   post:
 *     tags: [Finance — Opening Balances]
 *     summary: Undo the changeover and put the figures back on the worksheet
 *     description: >
 *       Opening balances are typed by a person from paperwork and getting them wrong first time
 *       is ordinary; without a way back the business would be stuck with wrong books for good.
 *       Both entries are reversed rather than deleted. Refused once anything has been posted
 *       after the changeover date — that work was done on top of these figures.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The worksheet, restored from the reversed entry }
 *       400: { description: Nothing to reopen, or work has been posted since }
 */
router.post(
  '/opening-balances/reopen',
  requirePermission('finance-reversal:change'),
  validate(reopenMigrationSchema),
  opening.reopen,
);

export default router;

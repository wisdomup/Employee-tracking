import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission, requireReport } from '../../middleware/permission.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createDraftSchema,
  updateDraftSchema,
  reverseEntrySchema,
  openPeriodSchema,
  openFiscalYearSchema,
  closePeriodSchema,
  reopenPeriodSchema,
  lockThroughSchema,
  setPostingSwitchSchema,
} from './dto/journal.schemas';
import * as journal from './journal.controller';

/**
 * Journal entries, accounting periods, and the three reports built directly on the ledger.
 *
 * Note the separation the routes enforce: posting is `finance-journal:change`, reversing is
 * `finance-reversal:change`. They are different rows so an accountant can record work without
 * being able to undo it — ordinary segregation of duties, and only expressible because reversal
 * has its own row.
 */
const router = Router();

router.use(authMiddleware);

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/journal:
 *   get:
 *     tags: [Finance — Journal]
 *     summary: List journal entries, newest first
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [draft, posted, reversed, void] } }
 *       - { in: query, name: sourceType, schema: { type: string } }
 *       - { in: query, name: period, schema: { type: string }, description: "YYYY-MM" }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: search, schema: { type: string }, description: "Narration, reference, or entry number" }
 *       - { in: query, name: limit, schema: { type: integer, default: 100, maximum: 500 } }
 *       - { in: query, name: skip, schema: { type: integer, default: 0 } }
 *     responses:
 *       200: { description: "{ entries, total, limit, skip }" }
 */
router.get('/journal', requirePermission('finance-journal:view'), journal.list);

/**
 * @openapi
 * /api/finance/journal/{id}:
 *   get:
 *     tags: [Finance — Journal]
 *     summary: One entry with its lines
 *     description: >
 *       Lines come back in one shape whether the entry is a draft or posted, so the screen does
 *       not need to know which it is looking at. `canPost` and `postBlockedReason` say whether
 *       the entry's month still accepts postings.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Entry with lines }
 *       404: { description: Not found }
 */
router.get('/journal/:id', requirePermission('finance-journal:view'), journal.getOne);

/**
 * @openapi
 * /api/finance/journal:
 *   post:
 *     tags: [Finance — Journal]
 *     summary: Create a draft entry
 *     description: >
 *       A draft moves no balance and carries no number. It may be saved unbalanced — an entry is
 *       built a line at a time — but it cannot be posted until debits equal credits.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, narration, lines]
 *             properties:
 *               date: { type: string, format: date }
 *               narration: { type: string }
 *               referenceNo: { type: string }
 *               lines:
 *                 type: array
 *                 minItems: 2
 *                 items:
 *                   type: object
 *                   properties:
 *                     ledgerId: { type: string }
 *                     debit: { type: number }
 *                     credit: { type: number }
 *                     lineNarration: { type: string }
 *     responses:
 *       201: { description: Draft created }
 *       400: { description: A line is malformed, or names a control account }
 */
router.post(
  '/journal',
  requirePermission('finance-journal:add'),
  validate(createDraftSchema),
  journal.createDraft,
);

/**
 * @openapi
 * /api/finance/journal/{id}:
 *   patch:
 *     tags: [Finance — Journal]
 *     summary: Edit a draft
 *     description: Drafts only. A posted entry is never edited — reverse it and post a corrected one.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Draft updated }
 *       400: { description: The entry is already posted }
 */
router.patch(
  '/journal/:id',
  requirePermission('finance-journal:edit'),
  validate(updateDraftSchema),
  journal.updateDraft,
);

/**
 * @openapi
 * /api/finance/journal/{id}:
 *   delete:
 *     tags: [Finance — Journal]
 *     summary: Delete a draft
 *     description: Drafts only. A posted entry is reversed, never deleted.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 *       400: { description: The entry is posted }
 */
router.delete('/journal/:id', requirePermission('finance-journal:delete'), journal.deleteDraft);

/**
 * @openapi
 * /api/finance/journal/{id}/post:
 *   patch:
 *     tags: [Finance — Journal]
 *     summary: Post a draft to the ledger
 *     description: >
 *       Refused unless debits equal credits, every account is active, no line touches a control
 *       account, and the entry's month is open. Once posted the entry is immutable — there is no
 *       edit or delete path for it anywhere in the application. Safe to retry.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Posted }
 *       400: { description: Unbalanced, closed month, or a control account on a manual entry }
 */
router.patch('/journal/:id/post', requirePermission('finance-journal:change'), journal.post);

/**
 * @openapi
 * /api/finance/journal/{id}/reverse:
 *   post:
 *     tags: [Finance — Journal]
 *     summary: Reverse a posted entry
 *     description: >
 *       Creates a new entry with every debit and credit swapped, linked to the original in both
 *       directions. Dated today by default — reversing into a prior month restates a period that
 *       has already been reported. Gated on `finance-reversal:change`, a different row from
 *       posting, so recording and correcting can be held by different people.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *               date: { type: string, format: date }
 *     responses:
 *       200: { description: "{ original, reversal }" }
 *       409: { description: Already reversed }
 */
router.post(
  '/journal/:id/reverse',
  requirePermission('finance-reversal:change'),
  validate(reverseEntrySchema),
  journal.reverse,
);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/reports/trial-balance:
 *   get:
 *     tags: [Finance — Reports]
 *     summary: Every account's closing balance, and the two totals that must agree
 *     description: >
 *       The integrity check for the whole system. An account sitting against its normal
 *       direction reports on the opposite side rather than as a negative, which is what keeps
 *       the two totals equal.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: asOf, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: "{ rows, totalDebit, totalCredit, difference, balanced }" }
 */
router.get(
  '/reports/trial-balance',
  requireReport('finance.trial-balance'),
  journal.trialBalance,
);

/**
 * @openapi
 * /api/finance/reports/ledger-statement/{ledgerId}:
 *   get:
 *     tags: [Finance — Reports]
 *     summary: One account, in date order, with a running balance
 *     description: >
 *       Everything before the window is collapsed into a single opening figure. Without it a
 *       filtered statement starts from zero and every running balance in it is wrong.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: ledgerId, required: true, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: "{ ledger, opening, closing, rows }" }
 */
router.get(
  '/reports/ledger-statement/:ledgerId',
  requireReport('finance.ledger-statement'),
  journal.ledgerStatement,
);

/**
 * @openapi
 * /api/finance/reports/day-book:
 *   get:
 *     tags: [Finance — Reports]
 *     summary: Every entry posted on a date or in a range, with its lines
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: "{ from, to, entries }" }
 */
router.get('/reports/day-book', requireReport('finance.day-book'), journal.dayBook);

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/periods:
 *   get:
 *     tags: [Finance — Periods]
 *     summary: Accounting months and whether each accepts postings
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: fiscalYear, schema: { type: string }, description: "e.g. 2026-27" }
 *     responses:
 *       200: { description: Periods }
 */
router.get('/periods', requirePermission('finance-period:view'), journal.listPeriods);

/**
 * @openapi
 * /api/finance/periods/{period}/checks:
 *   get:
 *     tags: [Finance — Periods]
 *     summary: What must be true before this month can close
 *     description: >
 *       Returned as a list rather than one boolean, so the screen can say which check failed and
 *       by how much. "Cannot close" with no reason is the kind of message that gets worked around.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: period, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "{ period, checks }" }
 */
router.get(
  '/periods/:period/checks',
  requirePermission('finance-period:view'),
  journal.periodChecks,
);

/**
 * @openapi
 * /api/finance/periods/open:
 *   post:
 *     tags: [Finance — Periods]
 *     summary: Open one month for posting
 *     description: >
 *       A month with no record is treated as CLOSED, not open — failing shut means a mistyped
 *       year is refused rather than quietly accepted into a year nobody looks at again.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Period opened }
 */
router.post(
  '/periods/open',
  requirePermission('finance-period:change'),
  validate(openPeriodSchema),
  journal.openPeriod,
);

/**
 * @openapi
 * /api/finance/periods/open-year:
 *   post:
 *     tags: [Finance — Periods]
 *     summary: Open all twelve months of a financial year
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ opened, skipped }" }
 */
router.post(
  '/periods/open-year',
  requirePermission('finance-period:change'),
  validate(openFiscalYearSchema),
  journal.openFiscalYear,
);

/**
 * @openapi
 * /api/finance/periods/close:
 *   post:
 *     tags: [Finance — Periods]
 *     summary: Close a month
 *     description: >
 *       Refused while any draft is unposted or the two column totals disagree. A snapshot of the
 *       closing balances is stored, so "the figures changed after sign-off" becomes provable.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Period closed }
 *       409: { description: A close check failed — the message names which }
 */
router.post(
  '/periods/close',
  requirePermission('finance-period:change'),
  validate(closePeriodSchema),
  journal.closePeriod,
);

/**
 * @openapi
 * /api/finance/periods/reopen:
 *   post:
 *     tags: [Finance — Periods]
 *     summary: Reopen a closed month
 *     description: Requires a reason, recorded on the period and in the activity log.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Period reopened }
 *       400: { description: Locked, or no reason given }
 */
router.post(
  '/periods/reopen',
  requirePermission('finance-period:change'),
  validate(reopenPeriodSchema),
  journal.reopenPeriod,
);

/**
 * @openapi
 * /api/finance/periods/lock-through:
 *   post:
 *     tags: [Finance — Periods]
 *     summary: Lock every month up to and including this one
 *     description: >
 *       Used at cutover to seal everything before the books opened. A locked month refuses
 *       everything, reversals included.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ locked }" }
 */
router.post(
  '/periods/lock-through',
  requirePermission('finance-period:change'),
  validate(lockThroughSchema),
  journal.lockThrough,
);

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/ledgers/{ledgerId}/recalculate:
 *   post:
 *     tags: [Finance — Journal]
 *     summary: Rebuild one account's balance from its posted lines
 *     description: The lines are the truth; the cached balance is a convenience over them.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: ledgerId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "{ balance, drift }" }
 */
router.post(
  '/ledgers/:ledgerId/recalculate',
  requirePermission('finance-coa:change'),
  journal.recalculate,
);

/**
 * @openapi
 * /api/finance/reconcile:
 *   post:
 *     tags: [Finance — Journal]
 *     summary: Prove every cached balance against the lines it came from
 *     description: >
 *       The same check the nightly job runs. Pass `repair=true` to rewrite drifted balances from
 *       the lines; without it the check reports drift it cannot fix.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: repair, schema: { type: boolean } }
 *     responses:
 *       200: { description: "{ checked, drifted }" }
 */
router.post('/reconcile', requirePermission('finance-coa:change'), journal.reconcile);

// ---------------------------------------------------------------------------
// Finance health
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/health/controls:
 *   get:
 *     tags: [Finance — Health]
 *     summary: Does the ledger still agree with the records behind it
 *     description: >
 *       Every control account proved against the operational figures. Returns the last recorded
 *       run; pass refresh=true to re-run now. A failing check blocks the month from closing.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: refresh, schema: { type: boolean } }
 *     responses:
 *       200: { description: Control check results }
 */
router.get('/health/controls', requireReport('finance.health'), journal.controlChecks);

/**
 * @openapi
 * /api/finance/health/controls/{checkId}/history:
 *   get:
 *     tags: [Finance — Health]
 *     summary: When this check was last seen agreeing
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: checkId, required: true, schema: { type: string } }
 *       - { in: query, name: days, schema: { type: integer } }
 *     responses:
 *       200: { description: Drift history }
 */
router.get('/health/controls/:checkId/history', requireReport('finance.health'), journal.controlHistory);

/**
 * @openapi
 * /api/finance/health/posting-switches:
 *   get:
 *     tags: [Finance — Health]
 *     summary: Which events post to the ledger by themselves
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Events with their state }
 */
router.get('/health/posting-switches', requirePermission('finance-period:view'), journal.postingSwitches);

/**
 * @openapi
 * /api/finance/health/posting-switches/{event}:
 *   patch:
 *     tags: [Finance — Health]
 *     summary: Turn one event on or off
 *     description: >
 *       One at a time, deliberately. Switching everything on at once means that if the books
 *       later disagree with the warehouse, there is no way to tell which event caused it.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: event, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The new state }
 */
router.patch('/health/posting-switches/:event', requirePermission('finance-period:change'), validate(setPostingSwitchSchema), journal.setPostingSwitch);

/**
 * @openapi
 * /api/finance/health/failed-postings:
 *   get:
 *     tags: [Finance — Health]
 *     summary: Postings the system could not write
 *     description: >
 *       Recorded rather than thrown, so a ledger misconfiguration can never refuse a delivery.
 *       Anything listed here is missing from the books until it is retried.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Failures }
 */
router.get('/health/failed-postings', requirePermission('finance-period:view'), journal.failedPostings);

/**
 * @openapi
 * /api/finance/health/failed-postings/retry:
 *   post:
 *     tags: [Finance — Health]
 *     summary: Retry every failed posting
 *     description: Safe at any time — every posting is idempotent by key.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Retry result }
 */
router.post('/health/failed-postings/retry', requirePermission('finance-period:change'), journal.retryPostings);

export default router;

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireReport } from '../../middleware/permission.middleware';
import * as trail from './trail.controller';

/**
 * Money trails: what any figure in this module is made of.
 *
 * One endpoint for every kind of figure, because the caller should not have to know which report
 * it came from. The response always has the same shape and each row carries the reference for the
 * next level down, so the client walks the trail without per-report knowledge.
 *
 * Its own report permission rather than a rider on each report: a trail that starts on the Cash
 * Flow can end on one shop's delivery, so it reaches further than any single report grants.
 */
const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/finance/trail:
 *   get:
 *     tags: [Finance — Money Trails]
 *     summary: What a figure is made of, and what was on the other side of it
 *     description: >
 *       Addressed by `kind`, which decides the other parameters. `ledger` explains an account
 *       balance, `group` a subtotal on the P&L or Balance Sheet, `party` one shop, supplier,
 *       rider, warehouse or member of staff within a control account, `entry` both sides of one
 *       journal entry, `source` everything one document did to the accounts, and `derived` a
 *       figure worked out in code rather than held on an account — gross profit, net profit, total
 *       assets, total equity — which comes back as the arithmetic that produced it, in `parts`.
 *
 *
 *       Every response carries `rows` summing to `total`, `counterparts` naming the accounts on
 *       the other side of those rows, and a `parent` reference for the figure this one rolls up
 *       into. Each row's `drill` is itself a trail reference, so the caller follows it without
 *       knowing what kind of figure it is about to open, and `document` names the order, receipt,
 *       bill or payroll run that caused the movement — with `href` null where that kind of
 *       document has no screen of its own.
 *
 *
 *       Lines are counted at status `posted` and `reversed` together, exactly as the trial balance
 *       counts them, so a reversed pair nets to nil and a trail never disagrees with the report it
 *       was opened from. Capped at 2000 rows, with `truncated` and a plain-words `note` when the
 *       cap bites.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: kind, required: true, schema: { type: string, enum: [ledger, group, party, entry, source, derived] } }
 *       - { in: query, name: report, schema: { type: string, enum: [profit-and-loss, balance-sheet] }, description: "Required for kind=derived" }
 *       - { in: query, name: figure, schema: { type: string, example: "grossProfit" }, description: "Required for kind=derived — the field name on that report" }
 *       - { in: query, name: ledgerId, schema: { type: string }, description: "Required for kind=ledger; narrows kind=party to one account" }
 *       - { in: query, name: groupId, schema: { type: string }, description: "Required for kind=group" }
 *       - { in: query, name: entryId, schema: { type: string }, description: "Required for kind=entry" }
 *       - { in: query, name: sourceId, schema: { type: string }, description: "Required for kind=source — the document's own id" }
 *       - { in: query, name: partyType, schema: { type: string, enum: [dealer, vendor, rider, warehouse, employee] } }
 *       - { in: query, name: partyId, schema: { type: string }, description: "Required for kind=party" }
 *       - { in: query, name: from, schema: { type: string, example: "2026-07-01" } }
 *       - { in: query, name: to, schema: { type: string, example: "2026-09-30" } }
 *     responses:
 *       200: { description: The trail behind the figure }
 *       400: { description: The parameters do not describe a figure — see the message }
 *       403: { description: Missing the Money Trails report }
 *       404: { description: The account, group, entry or document is not on file }
 */
router.get('/trail', requireReport('finance.trail'), trail.trail);

export default router;

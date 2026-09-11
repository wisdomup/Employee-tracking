import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireReport } from '../../middleware/permission.middleware';
import * as statements from './statements.controller';

/**
 * The financial statements.
 *
 * Each is its own report permission, granted one at a time like every other report. Profit and
 * the business's net worth are exactly the figures an owner may reasonably not want every finance
 * user to see, so holding the trial balance does not imply holding these.
 */
const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/finance/reports/profit-and-loss:
 *   get:
 *     tags: [Finance — Statements]
 *     summary: Profit & Loss for a range of months
 *     description: >
 *       Income, cost of sales, gross profit, operating expenses and net profit, grouped by the
 *       chart. Months rather than days, so a month-end is the business's own month-end. Defaults
 *       to the fiscal year to date. `compare` adds the window of the same length immediately before.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, example: "2026-07" } }
 *       - { in: query, name: to, schema: { type: string, example: "2026-09" } }
 *       - { in: query, name: compare, schema: { type: boolean } }
 *       - { in: query, name: showZero, schema: { type: boolean }, description: "Include accounts with nothing on them" }
 *     responses:
 *       200: { description: Profit & Loss }
 *       400: { description: A month is malformed, or the start is after the end }
 */
router.get(
  '/reports/profit-and-loss',
  requireReport('finance.profit-and-loss'),
  statements.profitAndLoss,
);

/**
 * @openapi
 * /api/finance/reports/balance-sheet:
 *   get:
 *     tags: [Finance — Statements]
 *     summary: Balance Sheet as at the end of a month
 *     description: >
 *       Assets, liabilities and equity. Equity includes profit brought forward from earlier years
 *       and profit for this year so far, computed from the income and expense accounts, so the
 *       statement balances whether or not a year has ever been closed. Carries warnings when
 *       Opening Balance Equity or Suspense are not zero.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: asOf, schema: { type: string, example: "2026-09" } }
 *       - { in: query, name: showZero, schema: { type: boolean } }
 *     responses:
 *       200: { description: Balance Sheet }
 */
router.get(
  '/reports/balance-sheet',
  requireReport('finance.balance-sheet'),
  statements.balanceSheet,
);

export default router;

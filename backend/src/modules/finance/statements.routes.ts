import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireReport } from '../../middleware/permission.middleware';
import * as statements from './statements.controller';

/**
 * The financial statements, and the reports about who owes whom.
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

/**
 * @openapi
 * /api/finance/reports/receivables-ageing:
 *   get:
 *     tags: [Finance — Statements]
 *     summary: What each shop owes, by how long ago the credit was taken
 *     description: >
 *       Read from each shop's lines on Accounts Receivable, applying recoveries and returns to the
 *       oldest credit first. Can be run as at any past day, and always totals to the receivables
 *       balance on that day. Shops holding credit with us are listed separately.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: asOf, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Receivables ageing }
 */
router.get(
  '/reports/receivables-ageing',
  requireReport('finance.receivables-ageing'),
  statements.receivablesAgeing,
);

/**
 * @openapi
 * /api/finance/reports/payables-ageing:
 *   get:
 *     tags: [Finance — Statements]
 *     summary: What is owed to each supplier today, by how overdue it is
 *     description: >
 *       Aged from posted bills against their due dates, with money paid on account as its own
 *       column. Each supplier's figure is checked against their share of Accounts Payable and
 *       flagged when the two disagree.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Payables ageing }
 */
router.get(
  '/reports/payables-ageing',
  requireReport('finance.payables-ageing'),
  statements.payablesAgeing,
);

/**
 * @openapi
 * /api/finance/reports/parties:
 *   get:
 *     tags: [Finance — Statements]
 *     summary: Shops or suppliers with anything on their account — the statement picker
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: type, required: true, schema: { type: string, enum: [dealer, vendor] } }
 *     responses:
 *       200: { description: Parties }
 */
router.get('/reports/parties', requireReport('finance.party-statement'), statements.partyList);

/**
 * @openapi
 * /api/finance/reports/party-statement:
 *   get:
 *     tags: [Finance — Statements]
 *     summary: One shop's or one supplier's account, with a running balance
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: type, required: true, schema: { type: string, enum: [dealer, vendor] } }
 *       - { in: query, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Party statement }
 *       404: { description: Shop or supplier not found }
 */
router.get(
  '/reports/party-statement',
  requireReport('finance.party-statement'),
  statements.partyStatement,
);

/**
 * @openapi
 * /api/finance/reports/cash-flow:
 *   get:
 *     tags: [Finance — Statements]
 *     summary: Where the cash came from and went, for a range of months
 *     description: >
 *       Follows only the cash and bank accounts. Each movement is classed by the account on the
 *       other side — operating, investing or financing — read from the chart. A transfer between
 *       cash and bank moves nothing; a cheque counts only when it clears. Opening plus the flows
 *       always equals closing.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, example: "2026-07" } }
 *       - { in: query, name: to, schema: { type: string, example: "2026-09" } }
 *     responses:
 *       200: { description: Cash flow }
 */
router.get('/reports/cash-flow', requireReport('finance.cash-flow'), statements.cashFlow);

/**
 * @openapi
 * /api/finance/reports/cash-position:
 *   get:
 *     tags: [Finance — Statements]
 *     summary: Each cash and bank account over a range of days, and cheques not yet cleared
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Cash and bank position }
 */
router.get('/reports/cash-position', requireReport('finance.cash-position'), statements.cashPosition);

export default router;

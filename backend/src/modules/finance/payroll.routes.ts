import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createRunSchema,
  updateRunSchema,
  payRunSchema,
  advanceSchema,
  cancelPayrollSchema,
} from './dto/payroll.schemas';
import * as payroll from './payroll.controller';

/**
 * Payroll and staff advances.
 *
 * Preparing a month is `add` and `edit`; posting it, paying it, and handing over an advance are all
 * `change`, held by somebody else — the same split as supplier payments, and for the same reason.
 * Cancelling is guarded on the reversals row, with every other undo.
 */
const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/finance/payroll/runs:
 *   get:
 *     tags: [Finance — Payroll]
 *     summary: List payroll runs, newest month first
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [draft, posted, cancelled, all] } }
 *     responses:
 *       200: { description: Payroll runs }
 */
router.get('/payroll/runs', requirePermission('finance-payroll:view'), payroll.listRuns);

/**
 * @openapi
 * /api/finance/payroll/runs/{id}:
 *   get:
 *     tags: [Finance — Payroll]
 *     summary: One payroll run, with every employee's line and what they still owe in advances
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Payroll run }
 *       404: { description: Not found }
 */
router.get('/payroll/runs/:id', requirePermission('finance-payroll:view'), payroll.getRun);

/**
 * @openapi
 * /api/finance/payroll/runs:
 *   post:
 *     tags: [Finance — Payroll]
 *     summary: Start a month, pre-filled from what each employee is paid
 *     description: >
 *       Every active employee with any salary, bonus or allowance recorded is included, and the
 *       figures are copied onto the run so they can be corrected before posting. Nothing reaches
 *       the accounts. One live run per month.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Draft payroll run }
 *       400: { description: Nobody has any pay recorded }
 *       409: { description: That month already has a run }
 */
router.post(
  '/payroll/runs',
  requirePermission('finance-payroll:add'),
  validate(createRunSchema),
  payroll.createRun,
);

/**
 * @openapi
 * /api/finance/payroll/runs/{id}:
 *   put:
 *     tags: [Finance — Payroll]
 *     summary: Correct a draft — pay figures, and how much of each advance comes back this month
 *     description: >
 *       A recovery may not exceed what the employee still owes, nor what they are paid this month.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Payroll run }
 *       400: { description: The run is posted, or a recovery is too large }
 */
router.put(
  '/payroll/runs/:id',
  requirePermission('finance-payroll:edit'),
  validate(updateRunSchema),
  payroll.updateRun,
);

/**
 * @openapi
 * /api/finance/payroll/runs/{id}:
 *   delete:
 *     tags: [Finance — Payroll]
 *     summary: Delete a draft payroll run
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 */
router.delete('/payroll/runs/:id', requirePermission('finance-payroll:delete'), payroll.removeRun);

/**
 * @openapi
 * /api/finance/payroll/runs/{id}/post:
 *   patch:
 *     tags: [Finance — Payroll]
 *     summary: Post the month — record the wage bill and what is owed to staff
 *     description: >
 *       Charges salaries and allowances, takes each recovery off that employee's advance balance,
 *       and credits Salaries Payable with the net. Dated the last day of the month it is for.
 *       It pays nobody: payments are recorded separately.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Posted payroll run }
 *       400: { description: A recovery is larger than what is still owed, or the month is closed }
 */
router.patch('/payroll/runs/:id/post', requirePermission('finance-payroll:change'), payroll.postRun);

/**
 * @openapi
 * /api/finance/payroll/runs/{id}/payments:
 *   post:
 *     tags: [Finance — Payroll]
 *     summary: Record wages actually handed over, in instalments
 *     description: Cash or bank transfer, never more than what is left owing on the run.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Payroll run, with the payment recorded }
 *       400: { description: More than is owed, or the run is not posted }
 */
router.post(
  '/payroll/runs/:id/payments',
  requirePermission('finance-payroll:change'),
  validate(payRunSchema),
  payroll.payRun,
);

/**
 * @openapi
 * /api/finance/payroll/runs/{id}/cancel:
 *   patch:
 *     tags: [Finance — Payroll]
 *     summary: Cancel a posted run and reverse the accrual
 *     description: Refused once any of the wages have been paid.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Cancelled payroll run }
 *       400: { description: Wages have already been paid against it }
 */
router.patch(
  '/payroll/runs/:id/cancel',
  requirePermission('finance-reversal:change'),
  validate(cancelPayrollSchema),
  payroll.cancelRun,
);

// ---------------------------------------------------------------------------
// Staff advances
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/payroll/advances:
 *   get:
 *     tags: [Finance — Payroll]
 *     summary: List staff advances
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [draft, posted, cancelled, all] } }
 *       - { in: query, name: userId, schema: { type: string } }
 *     responses:
 *       200: { description: Advances }
 */
/**
 * @openapi
 * /api/finance/payroll/employees:
 *   get:
 *     tags: [Finance — Payroll]
 *     summary: Active employees, with what each already owes in advances
 *     description: >
 *       The list the advance form picks from. Served here so somebody who may record an advance but
 *       may not browse staff records can still use it — it carries a name, a role and two figures.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Employees }
 */
router.get('/payroll/employees', requirePermission('finance-payroll:view'), payroll.employees);

router.get('/payroll/advances', requirePermission('finance-payroll:view'), payroll.listAdvances);

/**
 * @openapi
 * /api/finance/payroll/advances/balances:
 *   get:
 *     tags: [Finance — Payroll]
 *     summary: What each employee still owes, read from the ledger
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Outstanding advances by employee }
 */
router.get(
  '/payroll/advances/balances',
  requirePermission('finance-payroll:view'),
  payroll.advanceBalances,
);

/**
 * @openapi
 * /api/finance/payroll/advances:
 *   post:
 *     tags: [Finance — Payroll]
 *     summary: Prepare an advance to an employee
 *     description: Posts nothing. An advance is a debt the employee repays out of pay, not a cost.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Draft advance }
 *       400: { description: The employee is not active, or the account holds no money }
 */
router.post(
  '/payroll/advances',
  requirePermission('finance-payroll:add'),
  validate(advanceSchema),
  payroll.createAdvance,
);

/**
 * @openapi
 * /api/finance/payroll/advances/{id}:
 *   put:
 *     tags: [Finance — Payroll]
 *     summary: Correct a draft advance
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Advance }
 */
router.put(
  '/payroll/advances/:id',
  requirePermission('finance-payroll:edit'),
  validate(advanceSchema),
  payroll.updateAdvance,
);

/**
 * @openapi
 * /api/finance/payroll/advances/{id}:
 *   delete:
 *     tags: [Finance — Payroll]
 *     summary: Delete a draft advance
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 */
router.delete(
  '/payroll/advances/:id',
  requirePermission('finance-payroll:delete'),
  payroll.removeAdvance,
);

/**
 * @openapi
 * /api/finance/payroll/advances/{id}/post:
 *   patch:
 *     tags: [Finance — Payroll]
 *     summary: Hand the advance over
 *     description: >
 *       Debits Advances to Staff against that employee and credits the cash or bank account. No
 *       expense is recorded — it becomes wages when a payroll run recovers it.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Posted advance }
 */
router.patch(
  '/payroll/advances/:id/post',
  requirePermission('finance-payroll:change'),
  payroll.postAdvance,
);

/**
 * @openapi
 * /api/finance/payroll/advances/{id}/cancel:
 *   patch:
 *     tags: [Finance — Payroll]
 *     summary: Cancel a posted advance and reverse it
 *     description: Refused once any of it has been recovered from pay.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Cancelled advance }
 *       400: { description: Already recovered from pay }
 */
router.patch(
  '/payroll/advances/:id/cancel',
  requirePermission('finance-reversal:change'),
  validate(cancelPayrollSchema),
  payroll.cancelAdvance,
);

export default router;

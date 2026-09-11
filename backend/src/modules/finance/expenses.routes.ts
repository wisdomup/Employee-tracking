import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createCategorySchema,
  updateCategorySchema,
  createExpenseSchema,
  updateExpenseSchema,
  rejectExpenseSchema,
  cancelExpenseSchema,
} from './dto/expenses.schemas';
import { clearChequeSchema } from './dto/payments.schemas';
import * as expenses from './expenses.controller';

/**
 * Expenses and their categories.
 *
 * Three different powers, deliberately on different permission cells:
 *
 * - Recording and submitting an expense is `add` — part of the same act.
 * - Approving or rejecting one is `change`, held by somebody other than the usual submitter.
 * - Deciding which categories skip approval is its own row, because it is the approval policy
 *   itself. Whoever can edit a category's limit can make their own expenses stop needing approval.
 *
 * Cancelling a posted expense is on the reversals row, with every other undo.
 */
const router = Router();

router.use(authMiddleware);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/expense-categories:
 *   get:
 *     tags: [Finance — Expenses]
 *     summary: List expense categories and the approval rule each one carries
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [active, inactive, all] } }
 *     responses:
 *       200: { description: Categories }
 */
router.get(
  '/expense-categories',
  requirePermission('finance-expense-categories:view'),
  expenses.listCategories,
);

/**
 * @openapi
 * /api/finance/expense-categories:
 *   post:
 *     tags: [Finance — Expenses]
 *     summary: Create an expense category
 *     description: >
 *       The account must be an ordinary expense account. `requiresApproval` makes every expense
 *       in the category wait for a second person; `approvalAbove` makes only those above a figure
 *       wait.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Category }
 *       400: { description: The account is a control account or not an expense account }
 *       409: { description: A category with this name already exists }
 */
router.post(
  '/expense-categories',
  requirePermission('finance-expense-categories:add'),
  validate(createCategorySchema),
  expenses.createCategory,
);

/**
 * @openapi
 * /api/finance/expense-categories/{id}:
 *   put:
 *     tags: [Finance — Expenses]
 *     summary: Change a category's name, account, approval rule, or retire it
 *     description: >
 *       Re-pointing a category at a different account affects only what is posted from now on.
 *       Expenses already posted keep the account they posted to.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Category }
 */
router.put(
  '/expense-categories/:id',
  requirePermission('finance-expense-categories:edit'),
  validate(updateCategorySchema),
  expenses.updateCategory,
);

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/expenses:
 *   get:
 *     tags: [Finance — Expenses]
 *     summary: List expenses
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [draft, pending_approval, rejected, posted, cancelled, all] } }
 *       - { in: query, name: categoryId, schema: { type: string } }
 *       - { in: query, name: method, schema: { type: string, enum: [cash, bank_transfer, cheque] } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: search, schema: { type: string }, description: "Description, payee, cheque number or reference" }
 *       - { in: query, name: unclearedCheques, schema: { type: boolean } }
 *     responses:
 *       200: { description: Expenses }
 */
router.get('/expenses', requirePermission('finance-expenses:view'), expenses.list);

/**
 * @openapi
 * /api/finance/expenses/summary:
 *   get:
 *     tags: [Finance — Expenses]
 *     summary: Posted spending by category for a date range
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: "{ rows, amount, taxAmount, count }" }
 */
router.get('/expenses/summary', requirePermission('finance-expenses:view'), expenses.summary);

/**
 * @openapi
 * /api/finance/expenses/{id}:
 *   get:
 *     tags: [Finance — Expenses]
 *     summary: One expense
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Expense }
 *       404: { description: Not found }
 */
router.get('/expenses/:id', requirePermission('finance-expenses:view'), expenses.getOne);

/**
 * @openapi
 * /api/finance/expenses:
 *   post:
 *     tags: [Finance — Expenses]
 *     summary: Record an expense as a draft
 *     description: >
 *       Posts nothing. Spending on credit is not an expense — record it as a supplier bill, which
 *       is what raises Accounts Payable.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Draft expense }
 *       409: { description: This cheque number is already used from this account }
 */
router.post(
  '/expenses',
  requirePermission('finance-expenses:add'),
  validate(createExpenseSchema),
  expenses.create,
);

/**
 * @openapi
 * /api/finance/expenses/{id}:
 *   put:
 *     tags: [Finance — Expenses]
 *     summary: Correct a draft or rejected expense
 *     description: A corrected rejected expense returns to draft, keeping the rejection reason.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Expense }
 *       400: { description: Waiting for approval, posted, or cancelled }
 */
router.put(
  '/expenses/:id',
  requirePermission('finance-expenses:edit'),
  validate(updateExpenseSchema),
  expenses.update,
);

/**
 * @openapi
 * /api/finance/expenses/{id}:
 *   delete:
 *     tags: [Finance — Expenses]
 *     summary: Delete a draft or rejected expense
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted }
 */
router.delete('/expenses/:id', requirePermission('finance-expenses:delete'), expenses.remove);

/**
 * @openapi
 * /api/finance/expenses/{id}/submit:
 *   patch:
 *     tags: [Finance — Expenses]
 *     summary: Submit an expense — post it, or queue it for approval
 *     description: >
 *       The category decides which. An expense its category lets through posts immediately; any
 *       other waits for a second person. A category that requires a receipt refuses submission
 *       without one attached.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Posted or pending expense }
 *       400: { description: Receipt missing, category retired, or the month is closed }
 */
router.patch('/expenses/:id/submit', requirePermission('finance-expenses:add'), expenses.submit);

/**
 * @openapi
 * /api/finance/expenses/{id}/approve:
 *   patch:
 *     tags: [Finance — Expenses]
 *     summary: Approve a waiting expense, which posts it
 *     description: Refused to whoever submitted it.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Posted expense }
 *       400: { description: Not waiting for approval, or the approver submitted it }
 */
router.patch('/expenses/:id/approve', requirePermission('finance-expenses:change'), expenses.approve);

/**
 * @openapi
 * /api/finance/expenses/{id}/reject:
 *   patch:
 *     tags: [Finance — Expenses]
 *     summary: Send a waiting expense back, with the reason
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Rejected expense }
 */
router.patch(
  '/expenses/:id/reject',
  requirePermission('finance-expenses:change'),
  validate(rejectExpenseSchema),
  expenses.reject,
);

/**
 * @openapi
 * /api/finance/expenses/{id}/clear-cheque:
 *   patch:
 *     tags: [Finance — Expenses]
 *     summary: Record that the cheque for this expense has cleared
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Expense, with the clearing date }
 */
router.patch(
  '/expenses/:id/clear-cheque',
  requirePermission('finance-expenses:change'),
  validate(clearChequeSchema),
  expenses.clearCheque,
);

/**
 * @openapi
 * /api/finance/expenses/{id}/cancel:
 *   patch:
 *     tags: [Finance — Expenses]
 *     summary: Cancel a posted expense and reverse its entry
 *     description: Guarded on the reversals row. A cheque that has cleared cannot be cancelled.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Cancelled expense }
 */
router.patch(
  '/expenses/:id/cancel',
  requirePermission('finance-reversal:change'),
  validate(cancelExpenseSchema),
  expenses.cancel,
);

export default router;

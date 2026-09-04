import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createGroupSchema,
  updateGroupSchema,
  createLedgerSchema,
  updateLedgerSchema,
  setStatusSchema,
} from './dto/chart.schemas';
import * as chart from './chart.controller';

/**
 * Accounts & Finance — module routes.
 *
 * Step 01 exposes the chart of accounts only. Journal entries, periods and the posting engine
 * arrive in step 02 and gate on their own matrix rows.
 *
 * Two things that fail silently if forgotten when adding routes here:
 *
 *  1. A new route FILE in this folder must be added to BOTH lists in `config/swagger.ts` (the
 *     `.ts` entry and the `.js` entry) or its documentation is invisible in `/api/docs`.
 *     `test:swagger` fails the build on that, which is why it exists.
 *
 *  2. A permission key must be in `constants/permissions.ts` before a guard names it. Guards
 *     are validated against the catalogue at startup, so a key that is not there throws while
 *     the process boots rather than quietly denying every request in production.
 *
 *     Both of those guards read these files as RAW TEXT rather than parsing them, so a
 *     realistic-looking example written in a comment is picked up and checked as if it were
 *     code. Describe the syntax, do not spell it out.
 */
const router = Router();

router.use(authMiddleware);

// ---------------------------------------------------------------------------
// Account groups
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/chart/groups:
 *   get:
 *     tags: [Finance — Chart of Accounts]
 *     summary: List every account group, ordered for display
 *     description: >
 *       Returned flat with `depth`, `parentGroupId` and `sortOrder` so the caller can render a
 *       tree without a recursive fetch. `accountType` is set on a root group and inherited by
 *       its children, which is what decides the statement a ledger appears on.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Account groups }
 *       403: { description: Missing finance-coa:view }
 */
router.get('/chart/groups', requirePermission('finance-coa:view'), chart.listGroups);

/**
 * @openapi
 * /api/finance/chart/groups:
 *   post:
 *     tags: [Finance — Chart of Accounts]
 *     summary: Create an account group
 *     description: >
 *       `accountType` is required for a top-level group and ignored for a child, which inherits
 *       its parent's type — sending one that disagrees is refused rather than silently
 *       overridden. Groups nest at most four levels deep.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, code]
 *             properties:
 *               name: { type: string, example: "Current Assets" }
 *               code: { type: string, example: "1100" }
 *               accountType: { type: string, enum: [asset, liability, equity, income, expense] }
 *               parentGroupId: { type: string, nullable: true }
 *               sortOrder: { type: integer }
 *     responses:
 *       201: { description: Group created }
 *       400: { description: Code outside the type's block, depth exceeded, or type conflict }
 *       409: { description: Code already used by another group or ledger }
 */
router.post(
  '/chart/groups',
  requirePermission('finance-coa:add'),
  validate(createGroupSchema),
  chart.createGroup,
);

/**
 * @openapi
 * /api/finance/chart/groups/{id}:
 *   patch:
 *     tags: [Finance — Chart of Accounts]
 *     summary: Rename, re-code or reorder an account group
 *     description: >
 *       A group in the standard chart can be renamed and re-coded but never re-typed — the
 *       engine's accounts hang off it. Changing the type of any group is refused once it holds
 *       ledgers or child groups.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Group updated }
 *       400: { description: Refused — see the message }
 *       404: { description: Not found }
 */
router.patch(
  '/chart/groups/:id',
  requirePermission('finance-coa:edit'),
  validate(updateGroupSchema),
  chart.updateGroup,
);

/**
 * @openapi
 * /api/finance/chart/groups/{id}/status:
 *   patch:
 *     tags: [Finance — Chart of Accounts]
 *     summary: Activate or deactivate an account group
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isActive]
 *             properties:
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: Status changed }
 *       404: { description: Not found }
 */
router.patch(
  '/chart/groups/:id/status',
  requirePermission('finance-coa:change'),
  validate(setStatusSchema),
  chart.setGroupStatus,
);

/**
 * @openapi
 * /api/finance/chart/groups/{id}:
 *   delete:
 *     tags: [Finance — Chart of Accounts]
 *     summary: Delete an empty, non-standard account group
 *     description: >
 *       Refused for a group in the standard chart, and for any group still holding ledgers or
 *       child groups. Deactivate instead.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       400: { description: Part of the standard chart }
 *       409: { description: Not empty }
 */
router.delete('/chart/groups/:id', requirePermission('finance-coa:delete'), chart.deleteGroup);

// ---------------------------------------------------------------------------
// Ledgers
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/chart/ledgers:
 *   get:
 *     tags: [Finance — Chart of Accounts]
 *     summary: List ledgers
 *     description: >
 *       Defaults to active ledgers only. Each row carries the derived `normalBalance` and a
 *       `naturalBalance` — the balance in the account's own direction, so a negative value means
 *       something genuinely unusual (an overdrawn bank, a customer in credit) rather than a
 *       presentation detail.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: groupId, schema: { type: string } }
 *       - { in: query, name: accountType, schema: { type: string, enum: [asset, liability, equity, income, expense] } }
 *       - { in: query, name: isControl, schema: { type: boolean } }
 *       - { in: query, name: isCashEquivalent, schema: { type: boolean } }
 *       - { in: query, name: status, schema: { type: string, enum: [active, inactive, all] } }
 *       - { in: query, name: search, schema: { type: string }, description: "Name contains, or code starts with" }
 *     responses:
 *       200: { description: Ledgers }
 */
router.get('/chart/ledgers', requirePermission('finance-coa:view'), chart.listLedgers);

/**
 * @openapi
 * /api/finance/chart/ledgers/next-code:
 *   get:
 *     tags: [Finance — Chart of Accounts]
 *     summary: Suggest the next free code in a type's block
 *     description: >
 *       Steps by ten so an account can later be inserted where it belongs rather than appended
 *       at the end. Falls back to filling single gaps once the tens run out.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: accountType, schema: { type: string, enum: [asset, liability, equity, income, expense] } }
 *     responses:
 *       200: { description: "{ code }" }
 */
router.get(
  '/chart/ledgers/next-code',
  requirePermission('finance-coa:view'),
  chart.suggestCode,
);

/**
 * @openapi
 * /api/finance/chart/ledgers/{id}:
 *   get:
 *     tags: [Finance — Chart of Accounts]
 *     summary: One ledger, with its group, derived normal balance and reconciliation state
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Ledger }
 *       404: { description: Not found }
 */
router.get('/chart/ledgers/:id', requirePermission('finance-coa:view'), chart.getLedger);

/**
 * @openapi
 * /api/finance/chart/ledgers:
 *   post:
 *     tags: [Finance — Chart of Accounts]
 *     summary: Create a ledger
 *     description: >
 *       `code` is optional — the next free code in the group's block is allocated when it is
 *       omitted. A control ledger must name the subledger it summarises, and a non-control
 *       ledger must not carry one. Setting an opening balance here records it on the account;
 *       it posts nothing until the cutover entry is raised.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, groupId]
 *             properties:
 *               name: { type: string, example: "Bank — Meezan Current" }
 *               code: { type: string, example: "1121" }
 *               groupId: { type: string }
 *               description: { type: string }
 *               openingBalance:
 *                 type: object
 *                 properties:
 *                   amount: { type: number }
 *                   asOf: { type: string, format: date, nullable: true }
 *               isControl: { type: boolean }
 *               subledgerType: { type: string, enum: [dealer, vendor, rider, warehouse, employee], nullable: true }
 *               isCashEquivalent: { type: boolean }
 *     responses:
 *       201: { description: Ledger created }
 *       400: { description: Code outside the block, or an incoherent control configuration }
 *       409: { description: Code already in use }
 */
router.post(
  '/chart/ledgers',
  requirePermission('finance-coa:add'),
  validate(createLedgerSchema),
  chart.createLedger,
);

/**
 * @openapi
 * /api/finance/chart/ledgers/{id}:
 *   patch:
 *     tags: [Finance — Chart of Accounts]
 *     summary: Edit a ledger
 *     description: >
 *       Refuses anything that would restate history: moving a posted account to a group of a
 *       different type, turning a posted account into a control account, or editing the opening
 *       balance of an account that already has entries. Engine accounts can be renamed and
 *       re-coded but must keep their type.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Ledger updated }
 *       400: { description: Refused — see the message }
 *       404: { description: Not found }
 */
router.patch(
  '/chart/ledgers/:id',
  requirePermission('finance-coa:edit'),
  validate(updateLedgerSchema),
  chart.updateLedger,
);

/**
 * @openapi
 * /api/finance/chart/ledgers/{id}/status:
 *   patch:
 *     tags: [Finance — Chart of Accounts]
 *     summary: Activate or deactivate a ledger
 *     description: >
 *       Deactivating is refused while the account still holds a balance — the balance sheet
 *       would lose it silently.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isActive]
 *             properties:
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: Status changed }
 *       400: { description: Still holds a balance }
 */
router.patch(
  '/chart/ledgers/:id/status',
  requirePermission('finance-coa:change'),
  validate(setStatusSchema),
  chart.setLedgerStatus,
);

/**
 * @openapi
 * /api/finance/chart/ledgers/{id}:
 *   delete:
 *     tags: [Finance — Chart of Accounts]
 *     summary: Delete an unused, non-engine ledger
 *     description: >
 *       Refused for an engine account and for any account that has been posted to. There is no
 *       trash for finance records: deleting a posted account would remove its entries from
 *       reports that have already been read and signed off.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       400: { description: Used by the accounting engine }
 *       409: { description: Has entries posted to it }
 */
router.delete('/chart/ledgers/:id', requirePermission('finance-coa:delete'), chart.deleteLedger);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/finance/settings:
 *   get:
 *     tags: [Finance — Chart of Accounts]
 *     summary: Fiscal year, currency, ageing buckets and the engine's ledger map
 *     description: >
 *       `roles` maps each named engine role to the ledger it resolves to. The posting engine
 *       never hardcodes a code, which is what lets an accountant re-code and reorganise the
 *       chart without breaking anything.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Settings }
 *       404: { description: Settings document missing — run the chart seed }
 */
router.get('/settings', requirePermission('finance-coa:view'), chart.getSettings);

/**
 * @openapi
 * /api/finance/settings/health:
 *   get:
 *     tags: [Finance — Chart of Accounts]
 *     summary: Check that every engine role points at a live ledger
 *     description: >
 *       The same check the app runs at boot. Exposed so an admin editing the chart can confirm
 *       they have not orphaned a role without waiting for a restart.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ ok, problems[] }" }
 */
router.get('/settings/health', requirePermission('finance-coa:view'), chart.health);

export default router;

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAdmin, requirePermission } from '../../middleware/permission.middleware';
import * as controller from './account-freeze.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/account-freeze/me:
 *   get:
 *     tags: [Account Freeze]
 *     summary: The caller's own freeze state and the daily first-visit deadline
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: "{ isFrozen, frozenAt, frozenReason, deadline, subjectToRule }" }
 */
// Deliberately open to every authenticated role, and deliberately NOT behind the frozen
// write-block: a frozen rider must always be able to read why they are frozen.
router.get('/me', controller.myStatus);

/**
 * @openapi
 * /api/account-freeze:
 *   get:
 *     tags: [Account Freeze]
 *     summary: Everyone currently frozen, newest first [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Frozen users }
 */
router.get('/', requirePermission('account-freeze:view'), controller.findFrozen);

/**
 * @openapi
 * /api/account-freeze/sweep:
 *   post:
 *     tags: [Account Freeze]
 *     summary: Re-run the late-start sweep now [Admin]
 *     description: >
 *       Freezes riders who still have not checked in anywhere past the deadline, whether
 *       or not visits were assigned. Only the company holiday and approved leave excuse
 *       it. The daily cron calls the same routine; this endpoint is for re-running it
 *       after an outage. A no-op before the deadline and on the holiday.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: "{ evaluated, frozen, frozenWithNoAssignedVisits, skippedAlreadyStarted, skippedAlreadyFrozen }" }
 */
// Must stay above /:id-style routes.
router.post('/sweep', requireAdmin(), controller.runSweep);

/**
 * @openapi
 * /api/account-freeze/fines/overview:
 *   get:
 *     tags: [Account Freeze]
 *     summary: Frozen count and late-start fine totals, for the admin banner [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: "{ frozenCount, finedToday, finesTodayTotal, outstandingCount, outstandingTotal, defaultFineAmount }" }
 */
// Literal path, so it must sit above `/:id/...` — otherwise `fines` is read as a user id.
router.get('/fines/overview', requirePermission('account-freeze:view'), controller.fineOverview);

/**
 * @openapi
 * /api/account-freeze/fines/{fineId}/waive:
 *   patch:
 *     tags: [Account Freeze]
 *     summary: Cancel a late-start fine, leaving the freeze as it is [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fineId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note: { type: string, description: Why it was waived; kept on the fine and in the log }
 *     responses:
 *       200: { description: Fine waived }
 *       400: { description: Already waived }
 *       404: { description: Fine not found }
 */
router.patch(
  '/fines/:fineId/waive',
  requirePermission('account-freeze:change'),
  controller.waiveFine,
);

/**
 * @openapi
 * /api/account-freeze/{id}/fines:
 *   get:
 *     tags: [Account Freeze]
 *     summary: One rider's late-start fine history, newest first [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 200 }
 *     responses:
 *       200: { description: Fines }
 */
router.get('/:id/fines', requirePermission('account-freeze:view'), controller.riderFines);

/**
 * @openapi
 * /api/account-freeze/{id}/fine-amount:
 *   patch:
 *     tags: [Account Freeze]
 *     summary: Set this rider's own late-start fine, or clear it back to the default [Admin]
 *     description: >
 *       `amount` is whole rupees. `0` freezes the rider without fining them; `null` removes
 *       the per-rider amount so they follow the company default again. A fine already raised
 *       today, and not yet waived, is re-priced to the new amount.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount: { type: integer, nullable: true, minimum: 0 }
 *     responses:
 *       200: { description: "{ fineAmount, hasCustomFineAmount, todayFineUpdated }" }
 *       400: { description: Invalid amount }
 *       404: { description: User not found }
 */
router.patch(
  '/:id/fine-amount',
  requirePermission('account-freeze:change'),
  controller.setFineAmount,
);

/**
 * @openapi
 * /api/account-freeze/{id}/unfreeze:
 *   patch:
 *     tags: [Account Freeze]
 *     summary: Lift a freeze so the rider can work again [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note: { type: string, description: Why the freeze was lifted; kept in the activity log }
 *     responses:
 *       200: { description: Account unfrozen }
 *       400: { description: Account is not frozen }
 *       404: { description: User not found }
 */
router.patch('/:id/unfreeze', requirePermission('account-freeze:change'), controller.unfreeze);

export default router;

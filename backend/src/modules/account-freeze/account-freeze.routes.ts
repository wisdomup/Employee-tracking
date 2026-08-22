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

import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/permission.middleware';
import * as registers from './registers.controller';

/**
 * The registers of what was undone: reversals, and rider cash written off.
 *
 * Each is gated on the VIEW action of the row that governs doing it. Those two view cells were in
 * the matrix before any screen used them, so ticking one granted nothing; these reads are what they
 * now grant. Read-only on purpose — undoing an undo is an act on the document it belongs to.
 */
const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/finance/registers/reversals:
 *   get:
 *     tags: [Finance — Registers]
 *     summary: Every posted entry that was later reversed, newest first
 *     description: >
 *       Lists the ORIGINAL entry, which carries who reversed it, when and why, with the number of
 *       the entry that reversed it. Filtered on the day it was reversed rather than the original's
 *       date, so an old entry undone today appears under today. At most 500 rows, with
 *       `truncated` set when there were more.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, example: "2026-09-01" } }
 *       - { in: query, name: to, schema: { type: string, example: "2026-09-30" } }
 *     responses:
 *       200: { description: "{ rows, count, total, truncated }" }
 *       400: { description: A date is malformed, or the range is backwards }
 */
router.get('/registers/reversals', requirePermission('finance-reversal:view'), registers.reversals);

/**
 * @openapi
 * /api/finance/registers/write-offs:
 *   get:
 *     tags: [Finance — Registers]
 *     summary: Every shortfall written off a rider, newest first
 *     description: >
 *       Read from the settlements rather than the journal, so a write-off made while the
 *       settlement posting switch was off still appears. `unposted` counts the standing ones with
 *       no entry in the books. A voided write-off is listed and left out of `total`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, example: "2026-09-01" } }
 *       - { in: query, name: to, schema: { type: string, example: "2026-09-30" } }
 *     responses:
 *       200: { description: "{ rows, count, total, unposted, truncated }" }
 *       400: { description: A date is malformed, or the range is backwards }
 */
router.get('/registers/write-offs', requirePermission('finance-writeoff:view'), registers.writeOffs);

export default router;

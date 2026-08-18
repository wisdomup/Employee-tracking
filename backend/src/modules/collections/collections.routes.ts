import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { blockFrozenWrites } from '../../middleware/frozen.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  deliverOrderSchema,
  createRecoverySchema,
  createSettlementSchema,
  receiveSettlementSchema,
  correctCollectionSchema,
  correctRecoverySchema,
  correctSettlementSchema,
  voidEntrySchema,
} from './dto/collections.schemas';
import * as controller from './collections.controller';

/**
 * Delivery Boy (Rider) collection module — spec §§1-13.
 *
 * The rider's order list is a NEW endpoint here rather than a widening of `/api/orders`, because
 * `orders.controller.findAll` has no rider branch and would leak every order in the company.
 * Everything rider-facing hard-filters on `assignedRiderId`.
 *
 * Corrections and voids are `requireRoles('admin')` at the ROUTE, not behind a controller `if`.
 * Spec §7 ("rider cannot edit or delete their own entries") is easier to get wrong in a
 * controller than in a route table you can read top to bottom.
 */
const router = Router();

router.use(authMiddleware);
// A frozen rider may still read their day, but records no work until an admin unfreezes them.
router.use(blockFrozenWrites);

// ---------------------------------------------------------------------------
// Rider
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/collections/my/orders:
 *   get:
 *     tags: [Collections]
 *     summary: The rider's own admin-approved orders, grouped client-wise [Delivery Man]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, example: '2026-08-14' }
 *         description: Report-timezone day. Scopes DELIVERED orders only; open orders always show.
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [approved, packed, dispatched, delivered] }
 *     responses:
 *       200: { description: "{ date, timezone, rider, counts, groups[] }" }
 *       401: { description: Unauthorized }
 */
router.get('/my/orders', requireRoles('delivery_man'), controller.myOrders);

/**
 * @openapi
 * /api/collections/my/balance:
 *   get:
 *     tags: [Collections]
 *     summary: The rider's cash-in-hand, online outstanding and issued credit [Delivery Man]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: "{ cash{...}, online{...}, creditIssuedOutstanding }" }
 */
router.get('/my/balance', requireRoles('delivery_man'), controller.myBalance);

/**
 * @openapi
 * /api/collections/orders/{orderId}/packed:
 *   patch:
 *     tags: [Collections]
 *     summary: Mark an assigned order packed [Delivery Man]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Order marked packed }
 *       403: { description: Order is not assigned to you }
 *       404: { description: Order not found }
 *       409: { description: Already packed or delivered }
 */
router.patch('/orders/:orderId/packed', requireRoles('delivery_man'), controller.markPacked);

/**
 * @openapi
 * /api/collections/orders/{orderId}/deliver:
 *   post:
 *     tags: [Collections]
 *     summary: Deliver an order and record the cash/online/credit split [Delivery Man]
 *     description: >
 *       Cash + Online + Credit must equal the order's grand total (spec §4). The order amount is
 *       always taken from the order server-side and is never accepted from the request body.
 *       No stock movement occurs — stock left the warehouse when the order was created.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cash, online, credit]
 *             properties:
 *               cash: { type: number, minimum: 0 }
 *               online: { type: number, minimum: 0 }
 *               credit: { type: number, minimum: 0 }
 *               note: { type: string, maxLength: 500 }
 *     responses:
 *       201: { description: "{ order, collection, balance }" }
 *       400: { description: Split does not sum to the order total, or the client is in another city }
 *       403: { description: Order is not assigned to you }
 *       409: { description: Already delivered / collection already recorded }
 */
router.post(
  '/orders/:orderId/deliver',
  requireRoles('delivery_man'),
  validate(deliverOrderSchema),
  controller.deliver,
);

// ---------------------------------------------------------------------------
// Credit recovery (spec §5)
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/collections/recoveries:
 *   post:
 *     tags: [Collections]
 *     summary: Record recovery of old pending credit [Delivery Man, Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dealerId, amount, mode]
 *             properties:
 *               dealerId: { type: string }
 *               amount: { type: number, minimum: 0.01 }
 *               mode: { type: string, enum: [cash, online] }
 *               note: { type: string, maxLength: 500 }
 *     responses:
 *       201: { description: "{ recovery, dealerOutstanding, balance }" }
 *       400: { description: Amount exceeds the client's pending credit, or the client is in another city }
 *   get:
 *     tags: [Collections]
 *     summary: List credit recovery entries [Delivery Man (own only), Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: riderId, schema: { type: string } }
 *       - { in: query, name: dealerId, schema: { type: string } }
 *       - { in: query, name: cityKey, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string } }
 *       - { in: query, name: to, schema: { type: string } }
 *     responses:
 *       200: { description: "{ from, to, timezone, rows[], totals }" }
 */
router.post(
  '/recoveries',
  requireRoles('delivery_man', 'admin'),
  validate(createRecoverySchema),
  controller.createRecovery,
);
router.get('/recoveries', requireRoles('delivery_man', 'admin'), controller.listRecoveries);

/**
 * @openapi
 * /api/collections/dealers/{dealerId}/outstanding:
 *   get:
 *     tags: [Collections]
 *     summary: A client's pending credit (issued less recovered) [Delivery Man, Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dealerId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ dealerId, creditTotal, recoveredTotal, outstanding }" }
 */
router.get(
  '/dealers/:dealerId/outstanding',
  requireRoles('delivery_man', 'admin'),
  controller.dealerOutstanding,
);

// ---------------------------------------------------------------------------
// Settlement (spec §6)
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/collections/settlements:
 *   post:
 *     tags: [Collections]
 *     summary: Submit a settlement — cash goes to the office queue, online self-confirms [Delivery Man]
 *     description: >
 *       Cash settlements are created `pending` and do NOT reduce the rider's balance until an
 *       admin marks them received (spec §6 step 2). Online settlements are created `received`.
 *       Upload any screenshot via POST /api/upload first and pass the returned URL.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mode, amount]
 *             properties:
 *               mode: { type: string, enum: [cash, online] }
 *               amount: { type: number, minimum: 0.01 }
 *               note: { type: string, maxLength: 500 }
 *               screenshotUrl: { type: string, description: Online settlements only }
 *     responses:
 *       201: { description: "{ settlement, balance }" }
 *       400: { description: Amount exceeds what is available to settle, or a screenshot was sent with cash }
 *   get:
 *     tags: [Collections]
 *     summary: List settlements [Delivery Man (own only), Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: riderId, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [pending, received] } }
 *       - { in: query, name: mode, schema: { type: string, enum: [cash, online] } }
 *       - { in: query, name: cityKey, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string } }
 *       - { in: query, name: to, schema: { type: string } }
 *     responses:
 *       200: { description: "{ from, to, timezone, rows[], totals }" }
 */
router.post(
  '/settlements',
  requireRoles('delivery_man'),
  validate(createSettlementSchema),
  controller.submitSettlement,
);
router.get('/settlements', requireRoles('delivery_man', 'admin'), controller.listSettlements);

/**
 * @openapi
 * /api/collections/settlements/{id}/receive:
 *   patch:
 *     tags: [Collections]
 *     summary: Step 2 of the cash flow — confirm the money arrived [Admin]
 *     description: Only now does the rider's cash balance reduce (spec §6).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ settlement, riderBalance }" }
 *       400: { description: Not a cash settlement }
 *       409: { description: Already marked received }
 */
router.patch(
  '/settlements/:id/receive',
  requireRoles('admin'),
  (req, _res, next) => {
    if (req.body == null || typeof req.body !== 'object') req.body = {};
    next();
  },
  validate(receiveSettlementSchema),
  controller.receiveSettlement,
);

// ---------------------------------------------------------------------------
// Reports (spec §§8-11). Static paths declared BEFORE the /:id correction routes.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/collections/report:
 *   get:
 *     tags: [Collections]
 *     summary: Entry-wise collection report with per-city subtotals and a grand total [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: riderId, schema: { type: string } }
 *       - { in: query, name: cityKey, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string } }
 *       - { in: query, name: to, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 500, maximum: 2000 } }
 *     responses:
 *       200:
 *         description: >
 *           { from, to, timezone, filters, rows[], totals, cities[], page }. `totals` covers the
 *           whole filtered set, not just the current page.
 */
router.get('/report', requireRoles('admin'), controller.report);

/**
 * @openapi
 * /api/collections/activity:
 *   get:
 *     tags: [Collections]
 *     summary: Today's live activity per rider — counts, collection split, cash in hand, timeline [Admin, Delivery Man]
 *     description: Roster-driven, so a rider with no activity today still appears at zero.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: riderId, schema: { type: string }, description: "Omit or 'all' for every rider" }
 *       - { in: query, name: date, schema: { type: string } }
 *     responses:
 *       200: { description: "{ date, timezone, riders[], totals }" }
 */
router.get('/activity', requireRoles('admin', 'delivery_man'), controller.activity);

/**
 * @openapi
 * /api/collections/day-end:
 *   get:
 *     tags: [Collections]
 *     summary: Day-end summary — collection totals, delivered vs pending, order-wise list [Admin, Delivery Man]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: riderId, schema: { type: string } }
 *       - { in: query, name: cityKey, schema: { type: string } }
 *       - { in: query, name: date, schema: { type: string } }
 *     responses:
 *       200: { description: "{ date, timezone, totals, counts, orders[] }" }
 */
router.get('/day-end', requireRoles('admin', 'delivery_man'), controller.dayEnd);

/**
 * @openapi
 * /api/collections/riders:
 *   get:
 *     tags: [Collections]
 *     summary: Delivery boys with their live cash-in-hand, for the rider selectors [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: "[{ _id, username, fullName, city, cityKey, cashInHand }]" }
 */
router.get('/riders', requireRoles('admin'), controller.riders);

// ---------------------------------------------------------------------------
// Admin corrections and voids (spec §7). Admin-only at the route, deliberately.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /api/collections/recoveries/{id}:
 *   patch:
 *     tags: [Collections]
 *     summary: Rectify a credit recovery entry [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Corrected entry, with the change appended to its audit trail }
 */
router.patch(
  '/recoveries/:id',
  requireRoles('admin'),
  validate(correctRecoverySchema),
  controller.correctRecovery,
);
router.post(
  '/recoveries/:id/void',
  requireRoles('admin'),
  validate(voidEntrySchema),
  controller.voidRecovery,
);

/**
 * @openapi
 * /api/collections/settlements/{id}:
 *   patch:
 *     tags: [Collections]
 *     summary: Rectify a settlement [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Corrected settlement }
 */
router.patch(
  '/settlements/:id',
  requireRoles('admin'),
  validate(correctSettlementSchema),
  controller.correctSettlement,
);
router.post(
  '/settlements/:id/void',
  requireRoles('admin'),
  validate(voidEntrySchema),
  controller.voidSettlement,
);

/**
 * @openapi
 * /api/collections/{id}:
 *   patch:
 *     tags: [Collections]
 *     summary: Rectify a delivery collection — reallocate between cash/online/credit [Admin]
 *     description: >
 *       The three parts must still sum to the order amount, which is immutable. Changing the
 *       total is not a correction; void the entry instead. Every change is appended to the
 *       entry's `corrections[]` audit trail and mirrored to the activity log.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cash, online, credit]
 *             properties:
 *               cash: { type: number }
 *               online: { type: number }
 *               credit: { type: number }
 *               reason: { type: string }
 *     responses:
 *       200: { description: Corrected collection entry }
 *       400: { description: The corrected split does not sum to the order amount }
 */
router.patch(
  '/:id',
  requireRoles('admin'),
  validate(correctCollectionSchema),
  controller.correctCollection,
);

/**
 * @openapi
 * /api/collections/{id}/void:
 *   post:
 *     tags: [Collections]
 *     summary: Void a delivery collection [Admin]
 *     description: >
 *       The escape hatch for "delivered by mistake" — a correction cannot zero an entry without
 *       breaking the sum invariant. A voided entry counts for nothing in any balance or total but
 *       stays visible in the entry-wise report.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string, minLength: 3 }
 *     responses:
 *       200: { description: Voided entry }
 *       409: { description: Already voided }
 */
router.post('/:id/void', requireRoles('admin'), validate(voidEntrySchema), controller.voidCollection);

export default router;

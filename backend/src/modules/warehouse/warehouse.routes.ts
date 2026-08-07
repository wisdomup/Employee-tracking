import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as controller from './warehouse.controller';
import {
  createWarehouseSchema,
  updateWarehouseSchema,
  postOpeningStockSchema,
  createStockReceiptSchema,
  reasonSchema,
  resyncMirrorSchema,
  createTransferSchema,
  receiveTransferSchema,
  resolveMismatchSchema,
  createDamageClaimSchema,
  openStockCountSchema,
  saveStockCountSchema,
} from './dto/warehouse.schemas';

/**
 * Warehouse & stock management. Mounted at `/api/warehouse`.
 *
 * Route-level role gates are the enforceable truth — `admin/utils/permissions.ts` on the frontend
 * has no backend counterpart and is UX only. Anything that needs "…but only at YOUR warehouse" is
 * additionally scoped inside the service via `warehouse-scope.ts`.
 */
const router = Router();

router.use(authMiddleware);

/** Everyone who works in the module. Writes narrow further, per route. */
const WAREHOUSE_VIEWERS = ['admin', 'warehouse_manager', 'warehouse_staff'] as const;
/** Roles that may look up availability without being part of warehouse operations. */
const STOCK_READERS = [...WAREHOUSE_VIEWERS, 'sales_manager'] as const;

// ------------------------------------------------------------------ warehouses

/**
 * @openapi
 * /api/warehouse/warehouses:
 *   post:
 *     tags: [Warehouse]
 *     summary: Create a warehouse [Admin]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, city]
 *             properties:
 *               name: { type: string }
 *               city: { type: string, description: Free text; matched to a salesman's city for sale routing }
 *               address: { type: string }
 *               managerId: { type: string }
 *               isMain: { type: boolean, description: All Stock In lands in the Main warehouse }
 *               isActive: { type: boolean }
 *     responses:
 *       201: { description: Warehouse created }
 *       400: { description: Duplicate name or validation error }
 */
router.post(
  '/warehouses',
  requireRoles('admin'),
  validate(createWarehouseSchema),
  controller.createWarehouse,
);

/**
 * @openapi
 * /api/warehouse/warehouses:
 *   get:
 *     tags: [Warehouse]
 *     summary: List warehouses [Admin, Warehouse Manager, Warehouse Staff, Sales Manager]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: city, schema: { type: string } }
 *       - { in: query, name: isActive, schema: { type: string, enum: ['true', 'false'] } }
 *     responses:
 *       200: { description: Warehouses, Main first }
 */
router.get('/warehouses', requireRoles(...STOCK_READERS), controller.findAllWarehouses);

router.get('/warehouses/main', requireRoles(...STOCK_READERS), controller.getMainWarehouse);

/**
 * @openapi
 * /api/warehouse/warehouses/{id}:
 *   get:
 *     tags: [Warehouse]
 *     summary: Get one warehouse [Admin, Warehouse Manager, Warehouse Staff, Sales Manager]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Warehouse }
 *       404: { description: Not found }
 */
router.get('/warehouses/:id', requireRoles(...STOCK_READERS), controller.findWarehouse);

router.put(
  '/warehouses/:id',
  requireRoles('admin'),
  validate(updateWarehouseSchema),
  controller.updateWarehouse,
);

/**
 * @openapi
 * /api/warehouse/warehouses/{id}/set-main:
 *   patch:
 *     tags: [Warehouse]
 *     summary: Make this the Main warehouse [Admin]
 *     description: Clears the flag on the current Main first — a unique index allows only one.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Warehouse is now Main }
 */
router.patch('/warehouses/:id/set-main', requireRoles('admin'), controller.setMain);

router.delete('/warehouses/:id', requireRoles('admin'), controller.trashWarehouse);
router.patch('/warehouses/:id/restore', requireRoles('admin'), controller.restoreWarehouse);
router.delete(
  '/warehouses/:id/permanent',
  requireRoles('admin'),
  controller.permanentlyDeleteWarehouse,
);

// ------------------------------------------------------------------ stock reads

/**
 * @openapi
 * /api/warehouse/stock:
 *   get:
 *     tags: [Warehouse]
 *     summary: Current stock per warehouse and product, split Sellable / Damaged / In transit
 *     description: >
 *       Warehouse staff see only their own warehouse. Cost columns (`avgCost`, `lastPurchaseRate`,
 *       `stockValue`) are admin-only, the same rule as `Product.purchasePrice`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: warehouseId, schema: { type: string } }
 *       - { in: query, name: productId, schema: { type: string } }
 *       - { in: query, name: categoryId, schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: lowOnly, schema: { type: string, enum: ['true'] } }
 *       - { in: query, name: includeEmpty, schema: { type: string, enum: ['true'] } }
 *     responses:
 *       200: { description: Stock rows }
 */
router.get('/stock', requireRoles(...STOCK_READERS), controller.getStock);

/**
 * @openapi
 * /api/warehouse/stock/movements:
 *   get:
 *     tags: [Warehouse]
 *     summary: Stock movement history — everything that happened to a product
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: productId, schema: { type: string } }
 *       - { in: query, name: warehouseId, schema: { type: string } }
 *       - { in: query, name: bucket, schema: { type: string, enum: [sellable, damaged, in_transit] } }
 *       - { in: query, name: type, schema: { type: string } }
 *       - { in: query, name: startDate, schema: { type: string, format: date } }
 *       - { in: query, name: endDate, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Ledger rows, newest first }
 */
router.get('/stock/movements', requireRoles(...WAREHOUSE_VIEWERS), controller.getMovements);

router.get(
  '/products/:productId/last-purchase-rate',
  requireRoles(...WAREHOUSE_VIEWERS),
  controller.getLastPurchaseRate,
);

// ------------------------------------------------------------------ opening stock

/**
 * @openapi
 * /api/warehouse/opening-stock:
 *   post:
 *     tags: [Warehouse]
 *     summary: Post one-time starting stock for a warehouse [Admin]
 *     description: >
 *       One entry per warehouse+product, enforced by a unique index. The rate seeds the product's
 *       weighted-average cost. Correct a mistake by cancelling the entry, which frees the slot.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Opening stock posted }
 *       400: { description: Already entered for one of these products }
 */
router.post(
  '/opening-stock',
  requireRoles('admin'),
  validate(postOpeningStockSchema),
  controller.postOpeningStock,
);

router.get('/opening-stock', requireRoles('admin'), controller.findAllOpeningStock);
router.get(
  '/opening-stock/status/:warehouseId',
  requireRoles(...WAREHOUSE_VIEWERS),
  controller.getOpeningStockStatus,
);
router.patch(
  '/opening-stock/:id/cancel',
  requireRoles('admin'),
  validate(reasonSchema),
  controller.cancelOpeningStock,
);

// ------------------------------------------------------------------ stock in

/**
 * @openapi
 * /api/warehouse/stock-receipts:
 *   post:
 *     tags: [Warehouse]
 *     summary: Record a Stock In receipt [Admin, Warehouse Manager, Warehouse Staff]
 *     description: >
 *       Always lands in the Main warehouse — any `warehouseId` in the body is ignored. Updates the
 *       product's running weighted-average cost and its last purchase rate.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [receiptDate, products]
 *             properties:
 *               receiptDate: { type: string, format: date }
 *               supplierName: { type: string }
 *               notes: { type: string }
 *               products:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId: { type: string }
 *                     quantity: { type: integer, minimum: 1, description: Pieces, never cartons }
 *                     rate: { type: number, minimum: 0 }
 *     responses:
 *       201: { description: Receipt posted with a printable document number }
 *       400: { description: No Main warehouse configured, or validation error }
 */
router.post(
  '/stock-receipts',
  requireRoles(...WAREHOUSE_VIEWERS),
  validate(createStockReceiptSchema),
  controller.createStockReceipt,
);

router.get('/stock-receipts', requireRoles(...WAREHOUSE_VIEWERS), controller.findAllStockReceipts);
router.get(
  '/stock-receipts/:id',
  requireRoles(...WAREHOUSE_VIEWERS),
  controller.findStockReceipt,
);
router.get(
  '/stock-receipts/:id/slip',
  requireRoles(...WAREHOUSE_VIEWERS),
  controller.getStockReceiptSlip,
);

/**
 * @openapi
 * /api/warehouse/stock-receipts/{id}/cancel:
 *   patch:
 *     tags: [Warehouse]
 *     summary: Cancel a receipt with a reason and reverse its stock [Admin]
 *     description: >
 *       Receipts are never deleted. The reversal is guarded, so if the pieces have already left the
 *       Main warehouse the cancel is refused instead of driving stock negative.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Receipt cancelled and stock reversed }
 *       400: { description: Already cancelled, or the stock has already moved on }
 */
router.patch(
  '/stock-receipts/:id/cancel',
  requireRoles('admin'),
  validate(reasonSchema),
  controller.cancelStockReceipt,
);

// ------------------------------------------------------------------ transfers

/**
 * @openapi
 * /api/warehouse/transfers:
 *   post:
 *     tags: [Warehouse]
 *     summary: Raise a stock transfer [Admin, Warehouse Manager, Warehouse Staff]
 *     description: >
 *       No stock moves at this point — the transfer waits for admin approval. A scoped caller always
 *       sends from their own warehouse; an admin must supply `fromWarehouseId`.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Transfer raised, pending approval }
 *       400: { description: Same source and destination, or not enough stock at the source }
 */
router.post(
  '/transfers',
  requireRoles(...WAREHOUSE_VIEWERS),
  validate(createTransferSchema),
  controller.createTransfer,
);

router.get('/transfers', requireRoles(...WAREHOUSE_VIEWERS), controller.findAllTransfers);
router.get('/transfers/:id', requireRoles(...WAREHOUSE_VIEWERS), controller.findTransfer);
router.get('/transfers/:id/slip', requireRoles(...WAREHOUSE_VIEWERS), controller.getTransferSlip);

/**
 * @openapi
 * /api/warehouse/transfers/{id}/approve:
 *   patch:
 *     tags: [Warehouse]
 *     summary: Approve a transfer — stock leaves the source [Admin]
 *     description: >
 *       Moves the quantity from the source's sellable bucket into its in-transit bucket, so the goods
 *       are not sellable anywhere while they are on the road. Refused if you raised the transfer
 *       yourself.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Approved and stock is in transit }
 *       400: { description: Not pending, or not enough stock at the source }
 *       403: { description: You raised this transfer }
 */
router.patch('/transfers/:id/approve', requireRoles('admin'), controller.approveTransfer);

router.patch(
  '/transfers/:id/reject',
  requireRoles('admin'),
  validate(reasonSchema),
  controller.rejectTransfer,
);

/**
 * @openapi
 * /api/warehouse/transfers/{id}/receive:
 *   patch:
 *     tags: [Warehouse]
 *     summary: Confirm what actually arrived [Admin, or the destination warehouse]
 *     description: >
 *       Matching quantities complete the transfer. A shortfall flags it for admin review and credits
 *       ONLY what arrived, leaving the difference in the source's in-transit bucket. Receiving MORE
 *       than was sent is rejected — that would create stock from nothing.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Completed, or flagged as a quantity mismatch }
 *       400: { description: Over-receipt, an unsent product, or the transfer is not in transit }
 */
router.patch(
  '/transfers/:id/receive',
  requireRoles(...WAREHOUSE_VIEWERS),
  validate(receiveTransferSchema),
  controller.receiveTransfer,
);

router.patch(
  '/transfers/:id/resolve-mismatch',
  requireRoles('admin'),
  validate(resolveMismatchSchema),
  controller.resolveTransferMismatch,
);

/**
 * @openapi
 * /api/warehouse/transfers/{id}/cancel:
 *   patch:
 *     tags: [Warehouse]
 *     summary: Cancel a transfer with a reason and reverse its stock [Admin]
 *     description: >
 *       Cancelling a completed transfer takes the goods back off the destination's shelf. That leg is
 *       guarded, so if they have already been sold the cancellation is refused rather than driving
 *       stock negative.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Cancelled and stock reversed }
 *       400: { description: The destination has already consumed the stock }
 */
router.patch(
  '/transfers/:id/cancel',
  requireRoles('admin'),
  validate(reasonSchema),
  controller.cancelTransfer,
);

// ------------------------------------------------------------------ damage / claim

/**
 * @openapi
 * /api/warehouse/damage-claims:
 *   post:
 *     tags: [Warehouse]
 *     summary: Record damaged or claimed stock [Admin, Warehouse Manager, Warehouse Staff]
 *     description: >
 *       Creates a PENDING entry and moves no stock. `clientName` is required when `source` is
 *       `client_claim` — the damage report exists to answer who returned the goods.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [source, reason, products]
 *             properties:
 *               warehouseId: { type: string, description: Admin only; staff always use their own }
 *               source: { type: string, enum: [internal_damage, client_claim] }
 *               clientName: { type: string, description: Required for client_claim }
 *               dealerId: { type: string }
 *               reason: { type: string }
 *               products:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId: { type: string }
 *                     quantity: { type: integer, minimum: 1 }
 *     responses:
 *       201: { description: Entry raised, pending approval, no stock moved }
 */
router.post(
  '/damage-claims',
  requireRoles(...WAREHOUSE_VIEWERS),
  validate(createDamageClaimSchema),
  controller.createDamageClaim,
);

router.get('/damage-claims', requireRoles(...WAREHOUSE_VIEWERS), controller.findAllDamageClaims);
router.get('/damage-claims/:id', requireRoles(...WAREHOUSE_VIEWERS), controller.findDamageClaim);
router.get(
  '/damage-claims/:id/slip',
  requireRoles(...WAREHOUSE_VIEWERS),
  controller.getDamageClaimSlip,
);

/**
 * @openapi
 * /api/warehouse/damage-claims/{id}/approve:
 *   patch:
 *     tags: [Warehouse]
 *     summary: Approve a damage / claim entry [Admin]
 *     description: >
 *       Moves the quantity from Sellable to Damaged/Claim at that warehouse. Refused if you raised
 *       the entry yourself — approval is the only control on a write-off.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Approved and stock moved to the damaged bucket }
 *       400: { description: Not pending, or not enough sellable stock }
 *       403: { description: You raised this entry }
 */
router.patch('/damage-claims/:id/approve', requireRoles('admin'), controller.approveDamageClaim);

router.patch(
  '/damage-claims/:id/reject',
  requireRoles('admin'),
  validate(reasonSchema),
  controller.rejectDamageClaim,
);

router.patch(
  '/damage-claims/:id/cancel',
  requireRoles('admin'),
  validate(reasonSchema),
  controller.cancelDamageClaim,
);

// ------------------------------------------------------------------ stock counts

/**
 * @openapi
 * /api/warehouse/stock-counts/sheet/{warehouseId}:
 *   get:
 *     tags: [Warehouse]
 *     summary: Blank count sheet for a warehouse
 *     description: Every product the warehouse holds, with the system sellable and damaged figures.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: '{ warehouseId, periodMonth, rows }' }
 */
router.get(
  '/stock-counts/sheet/:warehouseId',
  requireRoles(...WAREHOUSE_VIEWERS),
  controller.getCountSheet,
);

/**
 * @openapi
 * /api/warehouse/stock-counts:
 *   post:
 *     tags: [Warehouse]
 *     summary: Open a monthly stock count [Admin, Warehouse Manager, Warehouse Staff]
 *     description: >
 *       Creates a draft prefilled with the system figures, so an untouched sheet means everything
 *       matches. Only one count may be open per warehouse at a time.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Draft count opened }
 *       400: { description: A count is already open for this warehouse }
 */
router.post(
  '/stock-counts',
  requireRoles(...WAREHOUSE_VIEWERS),
  validate(openStockCountSchema),
  controller.openStockCount,
);

router.get('/stock-counts', requireRoles(...WAREHOUSE_VIEWERS), controller.findAllStockCounts);
router.get('/stock-counts/report', requireRoles(...WAREHOUSE_VIEWERS), controller.getStockCountReport);
router.get('/stock-counts/:id', requireRoles(...WAREHOUSE_VIEWERS), controller.findStockCount);

router.put(
  '/stock-counts/:id',
  requireRoles(...WAREHOUSE_VIEWERS),
  validate(saveStockCountSchema),
  controller.saveStockCount,
);

/**
 * @openapi
 * /api/warehouse/stock-counts/{id}/submit:
 *   patch:
 *     tags: [Warehouse]
 *     summary: Submit a counted sheet for approval
 *     description: >
 *       Re-snapshots the system figures at this moment, so the variance recorded is the one the
 *       counter was actually looking at.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Submitted and an admin has been notified }
 */
router.patch(
  '/stock-counts/:id/submit',
  requireRoles(...WAREHOUSE_VIEWERS),
  controller.submitStockCount,
);

/**
 * @openapi
 * /api/warehouse/stock-counts/{id}/approve:
 *   patch:
 *     tags: [Warehouse]
 *     summary: Approve a count and correct the stock [Admin]
 *     description: >
 *       Applies `counted − systemAtSubmission` as a DELTA per line — never an absolute overwrite, so
 *       sales that happened while the sheet waited for approval are not erased. Lines whose live
 *       figure has moved since submission come back in `drift` for review.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: '{ count, drift }' }
 *       403: { description: You submitted this count }
 */
router.patch('/stock-counts/:id/approve', requireRoles('admin'), controller.approveStockCount);

router.patch(
  '/stock-counts/:id/reject',
  requireRoles('admin'),
  validate(reasonSchema),
  controller.rejectStockCount,
);

router.patch(
  '/stock-counts/:id/cancel',
  requireRoles(...WAREHOUSE_VIEWERS),
  validate(reasonSchema),
  controller.cancelStockCount,
);

// ------------------------------------------------------------------ reports

/**
 * @openapi
 * /api/warehouse/reports/valuation:
 *   get:
 *     tags: [Warehouse]
 *     summary: Sales and stock valuation over a date range
 *     description: >
 *       Best-selling products, current stock value and what it could sell for. Cost and profit
 *       figures are admin-only and are omitted entirely for other roles rather than zeroed.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: startDate, schema: { type: string, format: date } }
 *       - { in: query, name: endDate, schema: { type: string, format: date } }
 *       - { in: query, name: warehouseId, schema: { type: string } }
 *       - { in: query, name: categoryId, schema: { type: string } }
 *     responses:
 *       200: { description: '{ period, summary, bestSellers }' }
 */
router.get('/reports/valuation', requireRoles(...WAREHOUSE_VIEWERS), controller.getValuationReport);

router.get('/reports/low-stock', requireRoles(...WAREHOUSE_VIEWERS), controller.getLowStockReport);

// ------------------------------------------------------------------ maintenance

/**
 * @openapi
 * /api/warehouse/maintenance/integrity:
 *   get:
 *     tags: [Warehouse]
 *     summary: Drift report — mirror vs balances, balances vs ledger [Admin]
 *     description: >
 *       A non-empty result means some write path bypassed the stock ledger service. Expected to be
 *       empty at all times.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: '{ clean, driftCount, rows }' }
 */
router.get('/maintenance/integrity', requireRoles('admin'), controller.getIntegrity);

router.post(
  '/maintenance/resync-mirror',
  requireRoles('admin'),
  validate(resyncMirrorSchema),
  controller.resyncMirror,
);

export default router;

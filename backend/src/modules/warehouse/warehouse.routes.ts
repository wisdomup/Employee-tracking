import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  requireAdmin,
  requirePermission,
  requireReport,
} from '../../middleware/permission.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as controller from './warehouse.controller';
import {
  createWarehouseSchema,
  updateWarehouseSchema,
  postOpeningStockSchema,
  saveOpeningStockMatrixSchema,
  updateOpeningStockSchema,
  createStockReceiptSchema,
  updateStockReceiptSchema,
  reasonSchema,
  optionalReasonSchema,
  resyncMirrorSchema,
  createTransferSchema,
  receiveTransferSchema,
  resolveMismatchSchema,
  createDamageClaimSchema,
  openStockCountSchema,
  saveStockCountSchema,
  adjustStockSchema,
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
  requirePermission('warehouse:add'),
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
router.get('/warehouses', requirePermission('warehouse:view'), controller.findAllWarehouses);

router.get('/warehouses/main', requirePermission('warehouse:view'), controller.getMainWarehouse);

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
router.get('/warehouses/:id', requirePermission('warehouse:view'), controller.findWarehouse);

router.put(
  '/warehouses/:id',
  requirePermission('warehouse:edit'),
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
router.patch('/warehouses/:id/set-main', requirePermission('warehouse:change'), controller.setMain);

router.delete('/warehouses/:id', requirePermission('warehouse:delete'), controller.trashWarehouse);
router.patch('/warehouses/:id/restore', requirePermission('trash:change'), controller.restoreWarehouse);
router.delete(
  '/warehouses/:id/permanent',
  requirePermission('trash:delete'),
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
router.get('/stock', requirePermission('warehouse:view'), controller.getStock);

/**
 * @openapi
 * /api/warehouse/stock/matrix:
 *   get:
 *     tags: [Warehouse]
 *     summary: Live stock as a product × warehouse grid
 *     description: >
 *       Products down, warehouses across (Main first), Sellable / Damaged per warehouse, live
 *       balances. Driven from the catalogue, so EVERY non-trashed product gets a row even when it
 *       holds nothing anywhere — `cells` is sparse and an absent warehouse means zero. Inactive
 *       warehouses are included (deactivating one does not empty it) and are read-only. Warehouse
 *       staff get their own warehouse as the only column. `avgCost` is admin-only.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: categoryId, schema: { type: string } }
 *       - { in: query, name: lowOnly, schema: { type: string, enum: ['true'] } }
 *       - { in: query, name: nonZeroOnly, schema: { type: string, enum: ['true'] } }
 *       - { in: query, name: limit, schema: { type: integer, default: 2000, maximum: 5000 } }
 *     responses:
 *       200: { description: '{ warehouses, products, generatedAt, truncated, scopedWarehouseId? }' }
 */
router.get('/stock/matrix', requirePermission('warehouse:view'), controller.getStockMatrix);

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
router.get('/stock/movements', requirePermission('warehouse:view'), controller.getMovements);

router.get(
  '/products/:productId/last-purchase-rate',
  requirePermission('warehouse:view'),
  controller.getLastPurchaseRate,
);

// ------------------------------------------------------------------ stock adjustment

/**
 * @openapi
 * /api/warehouse/stock/adjust:
 *   post:
 *     tags: [Warehouse]
 *     summary: Correct stock figures in place [Admin]
 *     description: >
 *       Sets the Sellable / Damaged figures at one warehouse to the values given — these are
 *       absolute quantities, not deltas. Posts `manual_adjustment` movements through the stock
 *       ledger with the mandatory reason attached, so the change is fully audited. Admin-only,
 *       matching who may approve a stock count. `in_transit` cannot be adjusted: it is owned by the
 *       transfer documents.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [warehouseId, reason, lines]
 *             properties:
 *               warehouseId: { type: string }
 *               reason: { type: string, minLength: 3 }
 *               lines:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId: { type: string }
 *                     sellable: { type: integer, minimum: 0, description: New absolute figure }
 *                     damaged: { type: integer, minimum: 0, description: New absolute figure }
 *     responses:
 *       200: { description: '{ adjustedProducts, movements, changes }' }
 *       400: { description: Nothing changed, or the correction would drive a bucket negative }
 */
router.post(
  '/stock/adjust',
  requirePermission('warehouse:change'),
  validate(adjustStockSchema),
  controller.adjustStock,
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
  requirePermission('warehouse:change'),
  validate(postOpeningStockSchema),
  controller.postOpeningStock,
);

router.get('/opening-stock', requireAdmin(), controller.findAllOpeningStock);

/**
 * @openapi
 * /api/warehouse/opening-stock/matrix:
 *   get:
 *     tags: [Warehouse]
 *     summary: Every posted opening-stock cell, for the product × warehouse grid [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: '[{ _id, warehouseId, productId, sellableQty, damagedQty, rate }]' }
 *   post:
 *     tags: [Warehouse]
 *     summary: Save the opening-stock grid — enter new cells, correct existing ones [Admin]
 *     description: >
 *       Send only the cells that were touched. A cell with no entry yet is posted; one that already
 *       has an entry is corrected by reversing its movement and re-posting. Cells that would change
 *       nothing are skipped, and a cell whose stock cannot move is reported in `failed` without
 *       abandoning the rest of the save.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cells]
 *             properties:
 *               effectiveAt: { type: string, format: date }
 *               reason: { type: string, maxLength: 500 }
 *               cells:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [warehouseId, productId, sellableQty, damagedQty]
 *                   properties:
 *                     warehouseId: { type: string }
 *                     productId: { type: string }
 *                     sellableQty: { type: integer, minimum: 0 }
 *                     damagedQty: { type: integer, minimum: 0 }
 *                     rate: { type: number, minimum: 0 }
 *     responses:
 *       200: { description: '{ created, updated, skipped, failed }' }
 */
router.get('/opening-stock/matrix', requireAdmin(), controller.getOpeningStockMatrix);
router.post(
  '/opening-stock/matrix',
  requirePermission('warehouse:change'),
  validate(saveOpeningStockMatrixSchema),
  controller.saveOpeningStockMatrix,
);

router.get(
  '/opening-stock/status/:warehouseId',
  requirePermission('warehouse:view'),
  controller.getOpeningStockStatus,
);

/**
 * @openapi
 * /api/warehouse/opening-stock/{id}:
 *   put:
 *     tags: [Warehouse]
 *     summary: Correct one opening-stock entry's figures [Admin]
 *     description: >
 *       Reverses the movement the entry had applied and re-posts the new figures against the same
 *       row, so a corrected rate follows through to the product's average cost. Both quantities may
 *       be zero — the row stays posted and keeps its slot; cancel is what frees it.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The updated entry }
 *       400: { description: The entry is cancelled, or the correction would drive a bucket negative }
 */
router.put(
  '/opening-stock/:id',
  requirePermission('warehouse:edit'),
  validate(updateOpeningStockSchema),
  controller.updateOpeningStock,
);

router.patch(
  '/opening-stock/:id/cancel',
  requirePermission('warehouse:change'),
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
  requirePermission('stock-in:add'),
  validate(createStockReceiptSchema),
  controller.createStockReceipt,
);

router.get('/stock-receipts', requirePermission('stock-in:view'), controller.findAllStockReceipts);
router.get(
  '/stock-receipts/:id',
  requirePermission('stock-in:view'),
  controller.findStockReceipt,
);
router.get(
  '/stock-receipts/:id/slip',
  requirePermission('stock-in:view'),
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
  requirePermission('stock-in:change'),
  validate(reasonSchema),
  controller.cancelStockReceipt,
);

/**
 * @openapi
 * /api/warehouse/stock-receipts/{id}:
 *   put:
 *     tags: [Warehouse]
 *     summary: Correct a wrong Stock In receipt [Admin]
 *     description: >
 *       Replaces the receipt's whole line set, keeping the document number. Underneath, the
 *       original ledger posting is fully reversed and the new one applied, so a corrected rate
 *       drops out of the product's weighted-average cost and the new rate enters it. Refused if
 *       the pieces have already left the Main warehouse — a receipt whose goods have been sold
 *       or transferred cannot be rewritten. `reason` is mandatory.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [receiptDate, products, reason]
 *             properties:
 *               receiptDate: { type: string, format: date }
 *               supplierName: { type: string }
 *               notes: { type: string }
 *               reason: { type: string, description: Why the receipt is being corrected }
 *               products:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId: { type: string }
 *                     quantity: { type: integer, minimum: 1 }
 *                     rate: { type: number, minimum: 0 }
 *     responses:
 *       200: { description: Receipt corrected and the ledger re-posted }
 *       400: { description: Cancelled receipt, duplicate product line, or the stock has already moved on }
 *       403: { description: Forbidden — admin only }
 *       404: { description: Receipt or product not found }
 */
router.put(
  '/stock-receipts/:id',
  requirePermission('stock-in:edit'),
  validate(updateStockReceiptSchema),
  controller.updateStockReceipt,
);

/**
 * @openapi
 * /api/warehouse/stock-receipts/{id}:
 *   delete:
 *     tags: [Warehouse]
 *     summary: Delete a wrong Stock In receipt [Admin]
 *     description: >
 *       Reverses the receipt's stock and removes the row from every list and report. A soft
 *       delete — the ledger movements reference this document, so the row is trashed rather
 *       than dropped, keeping the audit trail intact. Refused if the pieces have already left
 *       the Main warehouse. An already-cancelled receipt is trashed without a second reversal.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Receipt deleted and its stock reversed }
 *       400: { description: The stock has already moved on }
 *       403: { description: Forbidden — admin only }
 *       404: { description: Receipt not found }
 */
router.delete(
  '/stock-receipts/:id',
  requirePermission('stock-in:delete'),
  validate(optionalReasonSchema),
  controller.deleteStockReceipt,
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
  requirePermission('transfers:add'),
  validate(createTransferSchema),
  controller.createTransfer,
);

router.get('/transfers', requirePermission('transfers:view'), controller.findAllTransfers);
router.get('/transfers/:id', requirePermission('transfers:view'), controller.findTransfer);
router.get('/transfers/:id/slip', requirePermission('transfers:view'), controller.getTransferSlip);

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
router.patch('/transfers/:id/approve', requireAdmin(), controller.approveTransfer);

router.patch(
  '/transfers/:id/reject',
  requireAdmin(),
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
  requirePermission('transfers:change'),
  validate(receiveTransferSchema),
  controller.receiveTransfer,
);

router.patch(
  '/transfers/:id/resolve-mismatch',
  requireAdmin(),
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
  requireAdmin(),
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
  requirePermission('damage:add'),
  validate(createDamageClaimSchema),
  controller.createDamageClaim,
);

router.get('/damage-claims', requirePermission('damage:view'), controller.findAllDamageClaims);
router.get('/damage-claims/:id', requirePermission('damage:view'), controller.findDamageClaim);
router.get(
  '/damage-claims/:id/slip',
  requirePermission('damage:view'),
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
router.patch('/damage-claims/:id/approve', requireAdmin(), controller.approveDamageClaim);

router.patch(
  '/damage-claims/:id/reject',
  requireAdmin(),
  validate(reasonSchema),
  controller.rejectDamageClaim,
);

router.patch(
  '/damage-claims/:id/cancel',
  // Cancelling a claim is not approving one — no stock is written off — so unlike
  // approve/reject this is a real matrix cell. Seeded to nobody, matching today's
  // admin-only behaviour, but an admin can now delegate it without a code change.
  requirePermission('damage:change'),
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
  requirePermission('stock-count:view'),
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
  requirePermission('stock-count:add'),
  validate(openStockCountSchema),
  controller.openStockCount,
);

router.get('/stock-counts', requirePermission('stock-count:view'), controller.findAllStockCounts);
router.get('/stock-counts/report', requirePermission('stock-count:view'), controller.getStockCountReport);
router.get('/stock-counts/:id', requirePermission('stock-count:view'), controller.findStockCount);

router.put(
  '/stock-counts/:id',
  requirePermission('stock-count:edit'),
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
  requirePermission('stock-count:change'),
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
router.patch('/stock-counts/:id/approve', requireAdmin(), controller.approveStockCount);

router.patch(
  '/stock-counts/:id/reject',
  requireAdmin(),
  validate(reasonSchema),
  controller.rejectStockCount,
);

router.patch(
  '/stock-counts/:id/cancel',
  requirePermission('stock-count:change'),
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
router.get('/reports/valuation', requireReport('warehouse-reports.valuation'), controller.getValuationReport);

router.get('/reports/low-stock', requireReport('warehouse-reports.stock'), controller.getLowStockReport);

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
router.get('/maintenance/integrity', requireAdmin(), controller.getIntegrity);

router.post(
  '/maintenance/resync-mirror',
  requireAdmin(),
  validate(resyncMirrorSchema),
  controller.resyncMirror,
);

export default router;

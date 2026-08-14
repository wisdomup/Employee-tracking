import { Request, Response, NextFunction } from 'express';
import * as warehousesService from './warehouses.service';
import * as stockService from './stock.service';
import * as stockAdjustmentsService from './stock-adjustments.service';
import * as openingStockService from './opening-stock.service';
import * as stockReceiptsService from './stock-receipts.service';
import * as ledger from './stock-ledger.service';
import * as transfersService from './stock-transfers.service';
import * as damageClaimsService from './damage-claims.service';
import * as stockCountsService from './stock-counts.service';
import * as reportsService from './warehouse-reports.service';
import {
  assertWarehouseAccess,
  assertWarehouseAccessEither,
  resolveWarehouseScope,
} from './warehouse-scope';

/** Controllers stay thin: unwrap the request, call the service, hand errors to the error handler. */
function viewer(req: Request) {
  return { userId: req.user!.userId, role: req.user!.role };
}

// ---------------------------------------------------------------------------- warehouses

export async function createWarehouse(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await warehousesService.createWarehouse(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function findAllWarehouses(req: Request, res: Response, next: NextFunction) {
  try {
    const { search, city, isActive } = req.query as Record<string, string>;
    res.json(await warehousesService.findAllWarehouses({ search, city, isActive }, viewer(req)));
  } catch (err) {
    next(err);
  }
}

export async function findWarehouse(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await warehousesService.findWarehouseById(req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function updateWarehouse(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await warehousesService.updateWarehouse(req.params.id, req.body, req.user?.userId));
  } catch (err) {
    next(err);
  }
}

export async function setMain(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await warehousesService.setMainWarehouse(req.params.id, req.user?.userId));
  } catch (err) {
    next(err);
  }
}

export async function trashWarehouse(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await warehousesService.trashWarehouse(req.params.id, req.user?.userId));
  } catch (err) {
    next(err);
  }
}

export async function restoreWarehouse(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await warehousesService.restoreWarehouse(req.params.id, req.user?.userId));
  } catch (err) {
    next(err);
  }
}

export async function permanentlyDeleteWarehouse(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await warehousesService.permanentlyDeleteWarehouse(req.params.id, req.user?.userId));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------- stock reads

export async function getStock(req: Request, res: Response, next: NextFunction) {
  try {
    const filters = req.query as stockService.StockRowFilters;
    res.json(await stockService.getWarehouseStock(filters, viewer(req)));
  } catch (err) {
    next(err);
  }
}

export async function getStockMatrix(req: Request, res: Response, next: NextFunction) {
  try {
    const filters = req.query as stockService.StockMatrixFilters;
    res.json(await stockService.getStockMatrix(filters, viewer(req)));
  } catch (err) {
    next(err);
  }
}

export async function getMovements(req: Request, res: Response, next: NextFunction) {
  try {
    const { productId, warehouseId, bucket, type, refType, startDate, endDate, limit } =
      req.query as Record<string, string>;

    // A scoped caller may only read their own warehouse's history.
    const scope = await resolveWarehouseScope(req.user!.userId, req.user!.role);
    if (scope !== null && warehouseId && String(scope) !== warehouseId) {
      return res.json([]);
    }

    res.json(
      await ledger.getMovementHistory({
        productId,
        warehouseId: warehouseId || (scope ? String(scope) : undefined),
        bucket,
        type,
        refType,
        startDate,
        endDate,
        limit: limit ? Number(limit) : undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function getLastPurchaseRate(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await stockService.getLastPurchaseRate(req.params.productId, req.user!.role));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------- stock adjustment

export async function adjustStock(req: Request, res: Response, next: NextFunction) {
  try {
    // Admin-only at the route, so the scope is always unrestricted — kept anyway so widening the
    // route gate later cannot silently hand a scoped user someone else's warehouse.
    await assertWarehouseAccess(req.user!.userId, req.user!.role, req.body.warehouseId);
    res.json(await stockAdjustmentsService.adjustStock(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------- opening stock

export async function postOpeningStock(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await openingStockService.postOpeningStock(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function findAllOpeningStock(req: Request, res: Response, next: NextFunction) {
  try {
    const { warehouseId, status } = req.query as Record<string, string>;
    res.json(await openingStockService.findAllOpeningStock({ warehouseId, status }));
  } catch (err) {
    next(err);
  }
}

export async function getOpeningStockStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await openingStockService.getOpeningStockStatus(req.params.warehouseId));
  } catch (err) {
    next(err);
  }
}

export async function getOpeningStockMatrix(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await openingStockService.getOpeningStockMatrix());
  } catch (err) {
    next(err);
  }
}

export async function saveOpeningStockMatrix(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await openingStockService.saveOpeningStockMatrix(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function updateOpeningStock(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await openingStockService.updateOpeningStock(req.params.id, req.body, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}

export async function cancelOpeningStock(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await openingStockService.cancelOpeningStock(req.params.id, req.body.reason, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------- stock in

export async function createStockReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await stockReceiptsService.createStockReceipt(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function findAllStockReceipts(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await stockReceiptsService.findAllStockReceipts(
        req.query as stockReceiptsService.StockReceiptFilters,
        viewer(req),
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function findStockReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    const receipt = await stockReceiptsService.findStockReceiptById(req.params.id);
    const warehouseId = (receipt.warehouseId as unknown as { _id?: unknown })?._id
      ?? receipt.warehouseId;
    await assertWarehouseAccess(req.user!.userId, req.user!.role, String(warehouseId));
    res.json(receipt);
  } catch (err) {
    next(err);
  }
}

export async function getStockReceiptSlip(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await stockReceiptsService.getStockReceiptSlip(req.params.id, req.user!.role));
  } catch (err) {
    next(err);
  }
}

export async function cancelStockReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await stockReceiptsService.cancelStockReceipt(req.params.id, req.body.reason, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}

export async function updateStockReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await stockReceiptsService.updateStockReceipt(req.params.id, req.body, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}

export async function deleteStockReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await stockReceiptsService.deleteStockReceipt(
        req.params.id,
        (req.body as { reason?: string })?.reason,
        req.user!.userId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function getMainWarehouse(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await stockReceiptsService.getMainWarehouse());
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------- transfers

export async function createTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await transfersService.createTransfer(req.body, viewer(req)));
  } catch (err) {
    next(err);
  }
}

export async function findAllTransfers(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await transfersService.findAllTransfers(
        req.query as transfersService.TransferFilters,
        viewer(req),
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function findTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    const transfer = await transfersService.findTransferById(req.params.id);
    const from = (transfer.fromWarehouseId as unknown as { _id?: unknown })?._id;
    const to = (transfer.toWarehouseId as unknown as { _id?: unknown })?._id;
    await assertWarehouseAccessEither(req.user!.userId, req.user!.role, [
      from as string,
      to as string,
    ]);
    res.json(transfer);
  } catch (err) {
    next(err);
  }
}

export async function approveTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await transfersService.approveTransfer(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function rejectTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await transfersService.rejectTransfer(req.params.id, req.body.reason, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}

export async function receiveTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await transfersService.receiveTransfer(req.params.id, req.body.lines, viewer(req)));
  } catch (err) {
    next(err);
  }
}

export async function resolveTransferMismatch(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await transfersService.resolveTransferMismatch(
        req.params.id,
        req.body.resolution,
        req.body.reason,
        req.user!.userId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function cancelTransfer(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await transfersService.cancelTransfer(req.params.id, req.body.reason, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}

export async function getTransferSlip(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await transfersService.getTransferSlip(req.params.id, viewer(req)));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------- damage / claim

export async function createDamageClaim(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await damageClaimsService.createDamageClaim(req.body, viewer(req)));
  } catch (err) {
    next(err);
  }
}

export async function findAllDamageClaims(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await damageClaimsService.findAllDamageClaims(
        req.query as damageClaimsService.DamageClaimFilters,
        viewer(req),
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function findDamageClaim(req: Request, res: Response, next: NextFunction) {
  try {
    const claim = await damageClaimsService.findDamageClaimById(req.params.id);
    const warehouseId =
      (claim.warehouseId as unknown as { _id?: unknown })?._id ?? claim.warehouseId;
    await assertWarehouseAccess(req.user!.userId, req.user!.role, String(warehouseId));
    res.json(claim);
  } catch (err) {
    next(err);
  }
}

export async function approveDamageClaim(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await damageClaimsService.approveDamageClaim(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function rejectDamageClaim(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await damageClaimsService.rejectDamageClaim(req.params.id, req.body.reason, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}

export async function cancelDamageClaim(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await damageClaimsService.cancelDamageClaim(req.params.id, req.body.reason, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}

export async function getDamageClaimSlip(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await damageClaimsService.getDamageClaimSlip(req.params.id, viewer(req)));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------- stock counts

export async function getCountSheet(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await stockCountsService.getCountSheet(req.params.warehouseId, viewer(req)));
  } catch (err) {
    next(err);
  }
}

export async function openStockCount(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await stockCountsService.openStockCount(req.body, viewer(req)));
  } catch (err) {
    next(err);
  }
}

export async function findAllStockCounts(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await stockCountsService.findAllStockCounts(
        req.query as stockCountsService.StockCountFilters,
        viewer(req),
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function findStockCount(req: Request, res: Response, next: NextFunction) {
  try {
    const count = await stockCountsService.findStockCountById(req.params.id);
    const warehouseId =
      (count.warehouseId as unknown as { _id?: unknown })?._id ?? count.warehouseId;
    await assertWarehouseAccess(req.user!.userId, req.user!.role, String(warehouseId));
    res.json(count);
  } catch (err) {
    next(err);
  }
}

export async function saveStockCount(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await stockCountsService.saveStockCountLines(req.params.id, req.body.lines, viewer(req)));
  } catch (err) {
    next(err);
  }
}

export async function submitStockCount(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await stockCountsService.submitStockCount(req.params.id, viewer(req)));
  } catch (err) {
    next(err);
  }
}

export async function approveStockCount(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await stockCountsService.approveStockCount(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function rejectStockCount(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await stockCountsService.rejectStockCount(req.params.id, req.body.reason, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}

export async function cancelStockCount(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await stockCountsService.cancelStockCount(req.params.id, req.body.reason, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}

export async function getStockCountReport(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await stockCountsService.getStockCountReport(
        req.query as stockCountsService.StockCountFilters,
        viewer(req),
      ),
    );
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------- reports

export async function getValuationReport(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await reportsService.getValuationReport(
        req.query as reportsService.ValuationFilters,
        req.user!.role,
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function getLowStockReport(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reportsService.getLowStockProducts());
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------- maintenance

export async function getIntegrity(_req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await ledger.getIntegrityReport();
    res.json({ clean: rows.length === 0, driftCount: rows.length, rows });
  } catch (err) {
    next(err);
  }
}

export async function resyncMirror(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await ledger.resyncMirror(req.body?.productIds));
  } catch (err) {
    next(err);
  }
}

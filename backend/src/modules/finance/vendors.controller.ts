import { Request, Response, NextFunction } from 'express';
import * as vendors from './vendors.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, string>;
    res.json(
      await vendors.listVendors({
        search: q.search,
        status: q.status as 'active' | 'inactive' | 'all' | undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vendors.getVendor(req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await vendors.createVendor(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vendors.updateVendor(req.params.id, req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function setStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await vendors.updateVendor(req.params.id, { isActive: req.body.isActive }, req.user!.userId),
    );
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vendors.deleteVendor(req.params.id, req.user!.userId));
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// The one-off clean-up
// ---------------------------------------------------------------------------

export async function candidates(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vendors.extractSuppliersFromReceipts());
  } catch (err) {
    next(err);
  }
}

export async function assignNames(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await vendors.assignSupplierNames(
        {
          vendorId: req.body.vendorId,
          newVendorName: req.body.newVendorName,
          typedNames: req.body.typedNames,
        },
        req.user!.userId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function parkUnassigned(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vendors.parkUnassignedReceipts(req.user!.userId));
  } catch (err) {
    next(err);
  }
}

export async function progress(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await vendors.migrationProgress());
  } catch (err) {
    next(err);
  }
}

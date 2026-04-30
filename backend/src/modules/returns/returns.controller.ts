import { Request, Response, NextFunction } from 'express';
import * as returnsService from './returns.service';
import { saveFile } from '../../services/file-upload.service';
import { forbidden } from '../../utils/app-error';
import { serializeReturnForRole, serializeReturnsForRole } from '../../utils/product-privacy';

function returnCreatedById(doc: { createdBy?: unknown }): string {
  const c = doc.createdBy;
  if (c == null) return '';
  if (typeof c === 'object' && c !== null && '_id' in c) {
    return String((c as { _id: unknown })._id);
  }
  return String(c);
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    let products = req.body.products;
    if (typeof products === 'string') {
      try {
        products = JSON.parse(products);
      } catch {
        res.status(400).json({ message: 'Invalid products JSON' });
        return;
      }
    }

    let invoiceImage: string | undefined;
    if (req.file) {
      invoiceImage = await saveFile(req.file, 'returns');
    }

    const returnDoc = await returnsService.createReturn(
      {
        dealerId: req.body.dealerId,
        returnType: req.body.returnType,
        products,
        invoiceImage,
        amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
        returnReason: req.body.returnReason || undefined,
      },
      req.user!.userId,
    );
    res.status(201).json(serializeReturnForRole(returnDoc, req.user?.role));
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { dealerId, returnType, status, createdBy } = req.query as Record<string, string>;
    let effectiveCreatedBy = createdBy;
    if (req.user?.role === 'order_taker') {
      effectiveCreatedBy = req.user.userId;
    }
    const returns = await returnsService.findAll({
      dealerId,
      returnType,
      status,
      createdBy: effectiveCreatedBy,
    });
    res.json(serializeReturnsForRole(returns as unknown[], req.user?.role));
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const returnDoc = await returnsService.findById(req.params.id);
    if (req.user?.role === 'order_taker' && req.user.userId) {
      if (returnCreatedById(returnDoc as { createdBy?: unknown }) !== req.user.userId) {
        return next(forbidden('You can only view returns you created'));
      }
    }
    res.json(serializeReturnForRole(returnDoc, req.user?.role));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user?.role === 'order_taker') {
      const existing = await returnsService.findById(req.params.id);
      if (returnCreatedById(existing as { createdBy?: unknown }) !== req.user!.userId) {
        return next(forbidden('You can only edit returns you created'));
      }
      if (existing.status !== 'pending') {
        return next(forbidden('Order takers can only edit returns that are still pending'));
      }
    }

    const updateData: Record<string, unknown> = { ...req.body };

    if (typeof updateData.products === 'string') {
      try {
        updateData.products = JSON.parse(updateData.products as string);
      } catch {
        res.status(400).json({ message: 'Invalid products JSON' });
        return;
      }
    }

    if (req.file) {
      updateData.invoiceImage = await saveFile(req.file, 'returns');
    }

    if (updateData.amount !== undefined) {
      updateData.amount = Number(updateData.amount);
    }

    const returnDoc = await returnsService.updateReturn(req.params.id, updateData, req.user?.userId);
    res.json(serializeReturnForRole(returnDoc, req.user?.role));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user?.role === 'order_taker') {
      const existing = await returnsService.findById(req.params.id);
      if (returnCreatedById(existing as { createdBy?: unknown }) !== req.user!.userId) {
        return next(forbidden('You can only delete returns you created'));
      }
      if (existing.status !== 'pending') {
        return next(forbidden('Order takers can only delete returns that are still pending'));
      }
    }
    const result = await returnsService.deleteReturn(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function restore(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await returnsService.restoreReturn(req.params.id, req.user?.userId);
    res.json(serializeReturnForRole(result, req.user?.role));
  } catch (err) {
    next(err);
  }
}

export async function removePermanent(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await returnsService.permanentlyDeleteReturn(req.params.id, req.user?.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

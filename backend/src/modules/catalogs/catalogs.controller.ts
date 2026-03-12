import { Request, Response, NextFunction } from 'express';
import * as catalogsService from './catalogs.service';
import { badRequest } from '../../utils/app-error';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const name = (req.body?.name as string)?.trim();
    if (!name) {
      throw badRequest('Name is required');
    }
    if (!req.file) {
      throw badRequest('PDF file is required');
    }
    const fileUrl = await catalogsService.saveCatalogFile(req.file);
    const catalog = await catalogsService.createCatalog(
      { name, fileUrl },
      req.user?.userId,
    );
    res.status(201).json(catalog);
  } catch (err) {
    next(err);
  }
}

export async function findAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { search } = req.query as Record<string, string>;
    const catalogs = await catalogsService.findAll({ search });
    res.json(catalogs);
  } catch (err) {
    next(err);
  }
}

export async function findOne(req: Request, res: Response, next: NextFunction) {
  try {
    const catalog = await catalogsService.findById(req.params.id);
    res.json(catalog);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const updates: { name?: string; fileUrl?: string } = {};
    const nameVal = req.body?.name;
    if (nameVal !== undefined && nameVal !== null) {
      const name = String(nameVal).trim();
      if (name) updates.name = name;
    }
    if (req.file) {
      const catalog = await catalogsService.findById(req.params.id);
      if (catalog?.fileUrl) {
        try {
          const { deleteFile } = await import('../../services/file-upload.service');
          await deleteFile(catalog.fileUrl);
        } catch {
          // ignore
        }
      }
      updates.fileUrl = await catalogsService.saveCatalogFile(req.file);
    }
    if (Object.keys(updates).length === 0) {
      return res.json(await catalogsService.findById(req.params.id));
    }
    const catalog = await catalogsService.updateCatalog(req.params.id, updates);
    res.json(catalog);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await catalogsService.deleteCatalog(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

import { CounterModel } from '../../models/counter.model';
import { badRequest } from '../../utils/app-error';

/**
 * Human-readable document numbers for warehouse paperwork, allocated the same atomic way as
 * sale invoice numbers (`order-invoice-counter.ts`).
 *
 * Allocate AFTER the stock movement succeeds, never before: a failed movement that had already
 * taken a number leaves a permanent gap in the printed document series.
 */
export type WarehouseDocumentKind =
  | 'stockReceiptNo'
  | 'stockTransferNo'
  | 'damageClaimNo'
  | 'stockCountNo';

export const WAREHOUSE_DOCUMENT_KINDS: WarehouseDocumentKind[] = [
  'stockReceiptNo',
  'stockTransferNo',
  'damageClaimNo',
  'stockCountNo',
];

export async function allocateNextDocumentNo(kind: WarehouseDocumentKind): Promise<number> {
  const doc = await CounterModel.findByIdAndUpdate(
    kind,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  ).lean();

  if (doc == null || typeof doc.seq !== 'number' || doc.seq < 1) {
    throw badRequest(`Failed to allocate a ${kind} document number`);
  }
  return doc.seq;
}

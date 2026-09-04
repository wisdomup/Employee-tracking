import { CounterModel } from '../../models/counter.model';
import { badRequest } from '../../utils/app-error';

/**
 * Document numbers for the Accounts & Finance module, allocated the same atomic way as sale
 * invoice numbers (`orders/order-invoice-counter.ts`) and warehouse paperwork
 * (`warehouse/warehouse-counters.ts`).
 *
 * ## Allocate at POST, never at draft
 *
 * The warehouse rule is "allocate after the stock movement succeeds, so a failed movement does
 * not leave a gap in the printed series". Finance has the same rule for a stricter reason: an
 * auditor will ask about a missing voucher number, and "someone opened a draft and closed the
 * tab" is not an answer anyone wants to give twice. A draft journal entry, bill or payment
 * carries no number at all until it is posted.
 */
export type FinanceDocumentKind =
  | 'financeJournalNo'
  | 'financeBillNo'
  | 'financeInvoiceNo'
  | 'financeExpenseNo'
  | 'financePaymentInNo'
  | 'financePaymentOutNo'
  | 'financeVendorNo';

export const FINANCE_DOCUMENT_KINDS: FinanceDocumentKind[] = [
  'financeJournalNo',
  'financeBillNo',
  'financeInvoiceNo',
  'financeExpenseNo',
  'financePaymentInNo',
  'financePaymentOutNo',
  'financeVendorNo',
];

export async function allocateNextFinanceNo(kind: FinanceDocumentKind): Promise<number> {
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

/**
 * Create any counter that does not exist yet, at zero.
 *
 * `allocateNextFinanceNo` upserts anyway, so this is not required for correctness. It exists so
 * a fresh database shows the full set of series in the `counters` collection rather than
 * materialising them one at a time as documents happen to be raised — which makes "has anything
 * been posted in this series yet?" answerable by looking.
 */
export async function seedFinanceCounters(): Promise<void> {
  for (const kind of FINANCE_DOCUMENT_KINDS) {
    await CounterModel.updateOne(
      { _id: kind },
      { $setOnInsert: { seq: 0 } },
      { upsert: true },
    ).exec();
  }
}

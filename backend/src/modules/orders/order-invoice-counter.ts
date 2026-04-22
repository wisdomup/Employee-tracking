import { CounterModel } from '../../models/counter.model';
import { badRequest } from '../../utils/app-error';

const ORDER_INVOICE_COUNTER_ID = 'orderInvoice';

/** Returns the next monotonic invoice number (1-based). Safe under concurrent creates. */
export async function allocateNextOrderInvoiceNumber(): Promise<number> {
  const doc = await CounterModel.findByIdAndUpdate(
    ORDER_INVOICE_COUNTER_ID,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  ).lean();
  if (doc == null || typeof doc.seq !== 'number' || doc.seq < 1) {
    throw badRequest('Failed to allocate invoice number');
  }
  return doc.seq;
}
